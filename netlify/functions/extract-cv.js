const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const PROMPT = `Tu es un assistant expert en recrutement médical français.
Analyse ce CV et extrais les informations structurées.

RÈGLES STRICTES :
- Réponds UNIQUEMENT en JSON valide, sans markdown, sans commentaire, sans texte autour
- Téléphone au format "06 00 00 00 00" (10 chiffres groupés par 2, séparés par un espace)
- Dates au format "JJ/MM/AAAA" (ex: "15/03/1985")
- Si une information est absente ou incertaine, utilise "" pour les chaînes et 0 pour les nombres
- Si champ liste absent, utilise []
- Nom de famille en MAJUSCULES, prénom en casse normale
- Expérience : entier arrondi, total d'années depuis le premier emploi jusqu'à aujourd'hui

FORMAT JSON REQUIS (respecte exactement ces clés) :
{
  "civilite": "M." ou "Mme",
  "nom": "NOM EN MAJUSCULES",
  "prenom": "Prénom",
  "telephone": "06 00 00 00 00",
  "email": "email@domaine.fr",
  "linkedin": "url LinkedIn complète ou vide",
  "specialite": "Fonction principale : Médecin / Infirmier / IDE / IPA / IADE / Sage-femme / Kiné / Aide-soignant / Pharmacien / etc.",
  "sousSpecialite": "Spécialité précise : Urgences / Cardiologie / Chirurgie / Psychiatrie / Pédiatrie / MPR / Gériatrie / Réanimation / Anesthésie / Oncologie / Neurologie / SSR / EHPAD / Bloc / MCO / HAD / Autre ou vide",
  "experience": 0,
  "diplome": "Diplôme principal (ex: Doctorat en médecine, DE Infirmier, etc.)",
  "dateNaissance": "JJ/MM/AAAA",
  "rpps": "numéro RPPS (11 chiffres) ou vide",
  "disponibilite": "Disponibilité indiquée (ex: Immédiate, 01/09/2025, Préavis 3 mois) ou vide",
  "contratSouhaite": ["CDI", "CDD", "Intérim", "Vacation", "Libéral"],
  "mobilite": ["régions ou départements mentionnés comme zone de mobilité"],
  "salaireMin": 0,
  "salaireMax": 0,
  "tempsTravail": "Temps plein" ou "Temps partiel" ou "Les deux",
  "notes": "Éléments notables du parcours en 1-2 phrases maximum"
}`;

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

function safeJSONParse(text) {
  try {
    return { ok: true, data: JSON.parse(text) };
  } catch (e1) {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return { ok: true, data: JSON.parse(match[0]) };
      } catch (e2) {
        return { ok: false, error: 'JSON malformé', raw: text.slice(0, 300) };
      }
    }
    return { ok: false, error: 'Aucun JSON détecté', raw: text.slice(0, 300) };
  }
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

    const apiKey = process.env.GEMINI_API_KEY || process.env.ANTHROPIC_API_KEY;
    if (!process.env.GEMINI_API_KEY) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({
          error: "GEMINI_API_KEY manquante dans la config Netlify. Ajoutez-la dans Site settings > Environment variables."
        })
      };
    }

    const geminiMime = mimeType === 'application/pdf' ? 'application/pdf' : mimeType;

    async function callGemini(prompt, model) {
      return fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{
              parts: [
                { inline_data: { mime_type: geminiMime, data: base64 } },
                { text: prompt }
              ]
            }],
            generationConfig: {
              temperature: 0.1,
              maxOutputTokens: 4096,
              responseMimeType: 'application/json'
            }
          })
        }
      );
    }

    let response = await callGemini(PROMPT, 'gemini-2.5-flash');
    let data = await response.json();

    if (!response.ok) {
      const errMsg = data.error?.message || JSON.stringify(data);
      return {
        statusCode: 502,
        headers,
        body: JSON.stringify({ error: `Erreur API Gemini : ${errMsg}` })
      };
    }

    let rawText = (data.candidates?.[0]?.content?.parts?.[0]?.text || '')
      .replace(/```json|```/g, '')
      .trim();

    let parsed = safeJSONParse(rawText);

    // Retry with simpler prompt if first attempt failed
    if (!parsed.ok) {
      const SIMPLE_PROMPT = 'Extrais les informations du CV en JSON valide. Format strict : {"civilite":"M./Mme","nom":"NOM","prenom":"Prenom","telephone":"","email":"","specialite":"","sousSpecialite":"","experience":0,"diplome":"","dateNaissance":"","rpps":"","disponibilite":"","linkedin":"","contratSouhaite":[],"mobilite":[],"salaireMin":0,"salaireMax":0,"tempsTravail":"Temps plein","notes":""}. Réponds UNIQUEMENT en JSON.';
      response = await callGemini(SIMPLE_PROMPT, 'gemini-2.5-flash');
      data = await response.json();
      if (response.ok) {
        rawText = (data.candidates?.[0]?.content?.parts?.[0]?.text || '')
          .replace(/```json|```/g, '')
          .trim();
        parsed = safeJSONParse(rawText);
      }
    }

    if (!parsed.ok) {
      return {
        statusCode: 502,
        headers,
        body: JSON.stringify({
          error: `Impossible de parser la réponse Gemini : ${parsed.error}`,
          raw: parsed.raw,
          hint: 'Le CV est peut-être scanné en image basse qualité ou dans un format non lisible. Saisissez les infos manuellement.'
        })
      };
    }

    const extracted = parsed.data || {};

    // Post-processing / normalization
    if (extracted.telephone) extracted.telephone = normalizePhone(extracted.telephone);
    if (extracted.dateNaissance) extracted.dateNaissance = normalizeDate(extracted.dateNaissance);
    if (extracted.nom) extracted.nom = String(extracted.nom).toUpperCase().trim();
    if (extracted.prenom) extracted.prenom = String(extracted.prenom).trim();
    if (extracted.email) extracted.email = String(extracted.email).toLowerCase().trim();
    if (!Array.isArray(extracted.contratSouhaite)) extracted.contratSouhaite = [];
    if (!Array.isArray(extracted.mobilite)) extracted.mobilite = [];
    if (typeof extracted.experience !== 'number') extracted.experience = parseInt(extracted.experience, 10) || 0;
    if (typeof extracted.salaireMin !== 'number') extracted.salaireMin = parseInt(extracted.salaireMin, 10) || 0;
    if (typeof extracted.salaireMax !== 'number') extracted.salaireMax = parseInt(extracted.salaireMax, 10) || 0;
    if (!['Temps plein', 'Temps partiel', 'Les deux'].includes(extracted.tempsTravail)) {
      extracted.tempsTravail = 'Temps plein';
    }

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
