# Micro Match Bot 🤝🎉

A friendly Slack bot that helps colleagues connect through shared interests.  
It collects people’s favorite topics during the week and automatically creates private Slack match rooms every Friday — sparking conversations and helping teammates discover new connections.

---

## 🚀 Why Micro Match Bot?
In distributed and hybrid workplaces, spontaneous connections rarely happen. People miss out on meeting colleagues outside of their usual circles. **Micro Match Bot** solves this by:

- **Encouraging networking**: matches colleagues based on shared interests.  
- **Boosting engagement**: creates 1:1 or group spaces that break silos.  
- **Fun ice breakers**: uses AI to generate conversation starters in English.  
- **Privacy-aware**: only collects the minimum data needed (name, country, interests, match preference).  

The result: stronger bonds, more collaboration, and a happier workplace 🎯.

---

## 🛠️ Tech Stack
- **Slack Platform**  
  - Events API (DMs, buttons, actions)  
  - Conversations API (create private channels, invite users)  
  - Block Kit (interactive buttons & messages)  

- **Node.js**  
  - Express.js for endpoints (`/slack/events`, `/slack/actions`, `/debug/*`)  
  - `@slack/web-api` for Slack integration  
  - `sqlite3` for lightweight persistent storage (users, responses)  

- **AI Layer**  
  - Azure OpenAI for:  
    - Canonicalizing interests (e.g., *nintendo, playstation → gaming*)  
    - Generating ice breakers in English  
    - Suggesting cultural topics
    - Give fun facts about countries for a belonging feel
    - Give the bot a friendly, approachable tone

- **Deployment**  
  - Runs on **Heroku** (or compatible Node hosting)  
  - Scheduler (Heroku add-on) to trigger matching and topic collection

---

## 🔑 Slack Bot Setup
This project requires creating a **Slack App** with a bot user.  
The app was granted the following **permissions (OAuth scopes)**:

- `chat:write` – send messages and DMs  
- `im:write` – start DMs with users  
- `users:read` – read user profile info (e.g., names)  
- `groups:write` – create and invite users to private channels  
- `channels:manage` (if public channels are ever needed)  
- `channels:read` / `groups:read` – to check existing channels when needed  

These permissions allow the bot to **create private match rooms, invite users, and send interactive messages** while collecting only the minimal data needed for matching.

---

## 📦 Project Structure
```
data/
├── db.js          # SQLite storage (users, responses, preferences)
src/
├── ai.js          # AI helper functions (topics normalization, ice breakers, suggestions)
├── matcher.js     # Core matching logic
├── server.js      # Slack events & actions (consent, read chat, button actions, exit/leave)
├── index.js       # Entrypoint (starts Express)
├── slackClient.js # Slack Web API client
```

---

## ⚙️ Environment Variables
```bash
# Slack
SLACK_BOT_TOKEN=xoxb-...

# Azure OpenAI
AZURE_OPENAI_API_KEY=...
AZURE_OPENAI_ENDPOINT=...
AZURE_OPENAI_DEPLOYMENT=...
AZURE_OPENAI_API_VERSION=2025-01-01-preview

# Cron security
CRON_TOKEN=some_random_secret
MATCH_HOST=your-app.herokuapp.com
```

---

## 🧑‍💻 Development
1. Clone the repo.  
2. Install dependencies:  
   ```bash
   brew install heroku/brew/heroku
   ``` 
   ```bash
   brew install sqlite
   ```
3. Test endpoints:  
   - `/debug/responses` – see saved responses  
   - `/debug/users` – see saved users
   - `/debug/match` – run matcher manually  

---

## 🌍 Value for Organizations
- **Culture & engagement**: strengthens community in hybrid/distributed teams.  
- **Diversity of connections**: matches people who may never meet otherwise.  
- **Simple adoption**: works natively inside Slack, no training required.  
- **Lightweight & secure**: minimal data collection, clear opt-out with *exit/leave*.  

Employees discover new colleagues, have fun conversations, and teams become more connected.  
For companies, that means **more collaboration, innovation, and retention**.  

---

## 🙋 Support
Questions or feedback? Ping **@Tiago Santos** in Slack.  
