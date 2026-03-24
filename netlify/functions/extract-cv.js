const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
};

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

    if (!process.env.ANTHROPIC_API_KEY) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured' }) };
    }

    const contentBlock = mimeType === 'application/pdf'
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } }
      : { type: 'image', source: { type: 'base64', media_type: mimeType, data: base64 } };

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2048,
        messages: [{
          role: 'user',
          content: [
            contentBlock,
            {
              type: 'text',
              text: `Analyse ce CV médical et extrais les informations. Réponds UNIQUEMENT en JSON strict sans markdown, sans commentaire, sans explication.
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
}`
            }
          ]
        }]
      })
    });

    const data = await response.json();

    if (!response.ok) {
      const errMsg = data.error?.message || JSON.stringify(data);
      return { statusCode: 502, headers, body: JSON.stringify({ error: `Anthropic API error: ${errMsg}` }) };
    }

    const text = (data.content?.[0]?.text || '{}').replace(/```json|```/g, '').trim();
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
