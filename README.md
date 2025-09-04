# Micro Match Bot

Micro Match Bot is a tool that helps people connect with others who share similar interests. It works with Slack, automatically matching users based on topics they care about and creating private chat groups for them to meet and talk.

## What Does It Do?

- Collects users' interests (topics) through a form or survey.
- Finds pairs of users who have at least one topic in common.
- Creates a private Slack channel for each matched pair.
- Invites both users to their new channel and sends a conversation starter to help break the ice.

## Who Is It For?

Anyone who wants to help people in their Slack workspace connect and network based on shared interests. No technical skills are needed to use the bot once it’s set up.

## How Does It Work?

1. **Users submit their interests** (for example, via a web form).
2. The bot regularly checks for new responses and looks for matches.
3. When a match is found, the bot creates a private Slack channel just for those users.
4. Both users are invited to the channel, and a friendly message is posted to help start the conversation.

## Getting Started

### What You Need

- A Slack workspace where you have permission to add bots.
- A Slack Bot Token (provided by Slack when you create a bot).
- Node.js and npm installed on your computer.

### Setup Steps

1. **Clone the project:**
    ```
   git clone ...
   ```
2. **Install the required software:**
    ``` 
    npm install ...
    ```
3. **Set up your Slack bot token:**
    - Create a file named `.env` in the main project folder.
    - Add this line to the file:
      ```
      SLACK_BOT_TOKEN=your-slack-bot-token
      ```

4. **Set up your database:**
    - Make sure the database for storing user responses is ready and accessible.

5. **Start the bot:**

## Project Structure

- `src/db.js` — Handles saving and retrieving user responses.
- `src/matcher.js` — Finds matches and creates Slack channels.
- `src/slackClient.js` — Connects to Slack and sends messages.

## Customization

- You can change how users are matched by editing `src/matcher.js`.
- To change how the bot talks to Slack, edit `src/slackClient.js`.
- To change how user responses are stored, edit `src/db.js`.

---

*Code developed with love and coffe by the ABC Fitness MicroMatchMakers team*