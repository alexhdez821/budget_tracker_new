# Budget Tracker - Netlify Deployment

A personal budget tracking app with AI-powered transaction reading from screenshots using Claude AI.

## 🚀 Deploy to Netlify

### Step 1: Push to GitHub

1. Create a new repository on GitHub
2. Upload all files from this folder
3. Push to GitHub:
```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YOUR_USERNAME/budget-tracker.git
git push -u origin main
```

### Step 2: Connect to Netlify

1. Go to [netlify.com](https://netlify.com) and sign in
2. Click **"Add new site"** → **"Import an existing project"**
3. Choose **GitHub** and select your repository
4. Netlify will auto-detect settings from `netlify.toml`
5. Click **"Deploy site"**

### Step 3: Add Environment Variable

**This is the most important step!**

1. In Netlify, go to **Site settings** → **Environment variables**
2. Click **"Add a variable"**
3. Key: `CLAUDE_API_KEY`
4. Value: Your Claude API key (get it from console.anthropic.com)
5. Click **"Save"**
6. Go to **Deploys** → **Trigger deploy** → **"Deploy site"**

### Step 4: Your Site is Live! 🎉

Your budget tracker will be at: `https://YOUR-SITE-NAME.netlify.app`

## 🔒 Security

✅ **Your API key is secure:**
- Stored as an environment variable in Netlify
- Never exposed in the browser or HTML source code
- Only accessible by the serverless function
- API calls go through your Netlify function, not directly from browser

## 📁 File Structure

```
budget-tracker/
├── index.html                          # Main budget tracker app
├── netlify/
│   └── functions/
│       └── analyze-transaction.js      # Serverless function for Claude API
├── netlify.toml                        # Netlify configuration
├── package.json                        # Dependencies for functions
└── README.md                           # This file
```

## 🛠️ Local Development

To test locally:

1. Install Netlify CLI:
```bash
npm install -g netlify-cli
```

2. Install dependencies:
```bash
npm install
```

3. Create `.env` file in the root:
```
CLAUDE_API_KEY=your_api_key_here
```

4. Run locally:
```bash
netlify dev
```

5. Open `http://localhost:8888`

**Note:** Never commit your `.env` file! It's already in `.gitignore`.

## 🎯 Features

- 📊 Monthly expense tracking with custom categories
- 💰 Multiple accounts (Checking, Free Money, Wedding)
- 📸 AI-powered screenshot transaction reading
- 📈 Visual budget progress bars
- 💾 All data stored locally in browser (localStorage)
- 🔒 Secure API key storage

## 📸 How to Use Screenshot Feature

1. Take a screenshot of your bank transactions
2. Click "📸 Scan Screenshot" button
3. Upload the image
4. AI will extract all transactions
5. Review and save to your budget

## 🔧 Troubleshooting

**"Failed to analyze image"**
- Make sure you added `CLAUDE_API_KEY` environment variable in Netlify
- Redeploy the site after adding the variable

**Function not found**
- Check that `netlify.toml` is in the root directory
- Verify `netlify/functions/analyze-transaction.js` exists

**API key errors**
- Verify your API key is valid at console.anthropic.com
- Make sure there are no extra spaces in the environment variable

## 💰 Cost

- **Netlify:** Free (100GB bandwidth, 125k function requests/month)
- **Claude API:** Pay per use (very affordable for personal use)
- Typical usage: ~$0.01-0.10 per screenshot analyzed

## 📝 License

MIT - Feel free to use and modify for personal projects!

## 🙏 Credits

Built with Claude AI by Anthropic
