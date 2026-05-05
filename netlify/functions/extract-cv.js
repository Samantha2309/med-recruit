const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const PROFESSIONS = [
  'Médecin',
  'Infirmier',
  'Sage-femme',
  'Masseur-Kinésithérapeute',
  'Aide-soignant',
  'Cadre de santé',
  'Pharmacien',
  'Autre'
];

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    civilite: { type: 'string', enum: ['M.', 'Mme', 'Dr', 'Dre'] },
    nom: { type: 'string' },
    prenom: { type: 'string' },
    telephone: { type: 'string' },
    email: { type: 'string' },
    linkedin: { type: 'string' },
    profession: { type: 'string', enum: PROFESSIONS },
    specialite: { type: 'string' },
    sousSpecialite: { type: 'string' },
    experience: { type: 'integer' },
    diplome: { type: 'string' },
    diplomas: { type: 'array', items: { type: 'string' } },
    education: { type: 'array', items: { type: 'string' } },
    dateNaissance: { type: 'string' },
    rpps: { type: 'string' },
    reside: { type: 'string' },
    disponibilite: { type: 'string' },
    contratSouhaite: { type: 'array', items: { type: 'string' } },
    salaireMin: { type: 'integer' },
    salaireMax: { type: 'integer' }
  },
  required: ['nom', 'prenom', 'profession']
};

const PROMPT = `Tu es un assistant expert en recrutement médical français. Analyse ce CV et extrais les informations.

RÈGLES :
- Téléphone au format "06 00 00 00 00" (10 chiffres groupés par 2)
- Dates au format JJ/MM/AAAA
- Nom en MAJUSCULES, prénom en casse normale
- profession : Médecin, Infirmier, Sage-femme, Masseur-Kinésithérapeute, Aide-soignant, Cadre de santé, Pharmacien, Autre
- specialite : sous-libellé du métier (ex: Médecin → Cardiologue, Urgentiste, MPR, Gériatre, Pédiatre)
- sousSpecialite : précision supplémentaire (ex: Néonatologie, Sport, Échographie cardiaque)
- diplome : diplôme d'exercice principal (Doctorat en médecine, DE Infirmier, DE Masseur-Kinésithérapeute, etc.)
- diplomas : tableau des DU/DIU spécifiquement (Diplômes Universitaires / Inter-Universitaires)
- education : tableau des autres formations / certifications complémentaires (sans années ni lieu)
- reside : "Ville, département" du candidat (ex: "Lyon, 69")
- experience : entier (années totales arrondies)
- contratSouhaite : tableau parmi ["CDI","CDD","Intérim","Vacation","Libéral"]
- Si information absente : "" pour string, 0 pour nombre, [] pour liste`;

function normalizePhone(v) {
  if (!v) return '';
  let d = String(v).replace(/\D/g, '');
  if (d.length === 12 && d.indexOf('330') === 0) d = '0' + d.slice(3);
  else if (d.length === 11 && d.indexOf('33') === 0) d = '0' + d.slice(2);
  if (d.length !== 10) return String(v);
  return (d.match(/.{1,2}/g) || []).join(' ');
}

function normalizeDate(v) {
  if (!v) return '';
  const s = String(v).trim();
  let m = /^(\d{1,2})[\/\-.\s](\d{1,2})[\/\-.\s](\d{2,4})$/.exec(s);
  if (m) {
    let y = m[3];
    if (y.length === 2) y = (parseInt(y, 10) > 30 ? '19' : '20') + y;
    return `${m[1].padStart(2, '0')}/${m[2].padStart(2, '0')}/${y}`;
  }
  m = /^(\d{4})[\/\-.\s](\d{2})[\/\-.\s](\d{2})$/.exec(s);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  return s;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: 'Method Not Allowed' };
  }

  try {
    const { base64, mimeType } = JSON.parse(event.body);

    if (!base64 || !mimeType) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'base64 and mimeType are required' }) };
    }

    if (!process.env.GEMINI_API_KEY) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({
          error: "GEMINI_API_KEY manquante dans la config Netlify."
        })
      };
    }

    const geminiMime = mimeType === 'application/pdf' ? 'application/pdf' : mimeType;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { inline_data: { mime_type: geminiMime, data: base64 } },
              { text: PROMPT }
            ]
          }],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 4096,
            responseMimeType: 'application/json',
            responseSchema: RESPONSE_SCHEMA
          }
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      const errMsg = data.error?.message || JSON.stringify(data);
      return {
        statusCode: 502,
        headers,
        body: JSON.stringify({ error: `Erreur API Gemini : ${errMsg}` })
      };
    }

    const rawText = (data.candidates?.[0]?.content?.parts?.[0]?.text || '{}').trim();

    let extracted;
    try {
      extracted = JSON.parse(rawText);
    } catch (parseErr) {
      return {
        statusCode: 502,
        headers,
        body: JSON.stringify({
          error: `Réponse Gemini non-JSON : ${parseErr.message}`,
          raw: rawText.slice(0, 300)
        })
      };
    }

    // Post-processing / normalization
    if (extracted.telephone) extracted.telephone = normalizePhone(extracted.telephone);
    if (extracted.dateNaissance) extracted.dateNaissance = normalizeDate(extracted.dateNaissance);
    if (extracted.nom) extracted.nom = String(extracted.nom).toUpperCase().trim();
    if (extracted.prenom) extracted.prenom = String(extracted.prenom).trim();
    if (extracted.email) extracted.email = String(extracted.email).toLowerCase().trim();
    if (!Array.isArray(extracted.contratSouhaite)) extracted.contratSouhaite = [];
    if (!Array.isArray(extracted.diplomas)) extracted.diplomas = [];
    if (!Array.isArray(extracted.education)) extracted.education = [];
    if (typeof extracted.experience !== 'number') extracted.experience = parseInt(extracted.experience, 10) || 0;
    if (typeof extracted.salaireMin !== 'number') extracted.salaireMin = parseInt(extracted.salaireMin, 10) || 0;
    if (typeof extracted.salaireMax !== 'number') extracted.salaireMax = parseInt(extracted.salaireMax, 10) || 0;
    if (!PROFESSIONS.includes(extracted.profession)) extracted.profession = 'Autre';

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(extracted)
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: `Erreur serveur : ${err.message}` })
    };
  }
};
