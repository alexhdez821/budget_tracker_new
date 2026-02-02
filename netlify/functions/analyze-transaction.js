const fetch = require('node-fetch');

exports.handler = async (event, context) => {
    // Only allow POST requests
    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            body: JSON.stringify({ error: 'Method not allowed' })
        };
    }

    try {
        const { imageData, mimeType } = JSON.parse(event.body);

        if (!imageData || !mimeType) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'Missing imageData or mimeType' })
            };
        }

        // Check if API key is configured
        if (!process.env.CLAUDE_API_KEY) {
            return {
                statusCode: 500,
                body: JSON.stringify({ 
                    error: 'Claude API key not configured in Netlify environment variables' 
                })
            };
        }

        // Call Claude API
        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': process.env.CLAUDE_API_KEY,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
                model: 'claude-sonnet-4-20250514',
                max_tokens: 2000,
                messages: [{
                    role: 'user',
                    content: [
                        {
                            type: 'image',
                            source: {
                                type: 'base64',
                                media_type: mimeType,
                                data: imageData
                            }
                        },
                        {
                            type: 'text',
                            text: `Analyze this bank transaction screenshot. Extract ALL transactions visible and return ONLY a JSON array with NO other text, explanation, or markdown. 

Format: [{"store": "merchant or description", "amount": number (positive value, no dollar sign), "date": "YYYY-MM-DD"}]

Rules:
- Extract EVERY transaction you see
- "store" should be the merchant name or transaction description
- "amount" must be a positive number (e.g., 5.39, not -5.39)
- "date" in YYYY-MM-DD format - ALWAYS use 2026 as the year unless a different year is explicitly shown
- If only month and day are visible, use 2026 as the year
- Return ONLY the JSON array, no other text`
                        }
                    ]
                }]
            })
        });

        const data = await response.json();

        if (!response.ok) {
            return {
                statusCode: response.status,
                body: JSON.stringify({ 
                    error: data.error?.message || 'Claude API request failed' 
                })
            };
        }

        // Extract and clean the response
        let responseText = data.content[0].text.trim();
        responseText = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '');

        // Parse and validate JSON
        const transactions = JSON.parse(responseText);

        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ transactions })
        };

    } catch (error) {
        console.error('Error processing request:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ 
                error: 'Failed to process image: ' + error.message 
            })
        };
    }
};
