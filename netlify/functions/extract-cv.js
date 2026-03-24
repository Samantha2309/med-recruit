const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const PROMPT = `Analyse ce CV médical et extrais les informations. Réponds UNIQUEMENT en JSON strict sans markdown, sans commentaire, sans explication.
{
  "civilite": "M." ou "Mme",
  "nom": "NOM EN MAJUSCULES",
  "prenom": "Prénom",
  "telephone": "numéro ou vide",
  "email": "email ou vide",
  "specialite": "fonction : Médecin / Infirmier / IDE / IPA / IADE / Sage-femme / etc.",
  "sousSpecialite": "spécialité médicale : Urgences / Cardiologie / SSR / MPR / etc. sinon vide",
  "experience": nombre entier années expérience,
  "diplome": "diplôme principal",
  "dateNaissance": "JJ/MM/AAAA ou vide",
  "rpps": "numéro RPPS ou vide",
  "disponibilite": "disponibilité ou vide"
}`;

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
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'GEMINI_API_KEY not configured' }) };
    }

    const geminiMime = mimeType === 'application/pdf' ? 'application/pdf' : mimeType;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
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
            maxOutputTokens: 2048,
            responseMimeType: 'application/json'
          }
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      const errMsg = data.error?.message || JSON.stringify(data);
      return { statusCode: 502, headers, body: JSON.stringify({ error: `Gemini API error: ${errMsg}` }) };
    }

    const text = (data.candidates?.[0]?.content?.parts?.[0]?.text || '{}').replace(/```json|```/g, '').trim();
    const extracted = JSON.parse(text);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(extracted)
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message })
    };
  }
};
