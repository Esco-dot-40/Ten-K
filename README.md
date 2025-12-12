# Multiplayer Farkle for Discord

A real-time multiplayer Farkle game designed to be played as a Discord Activity or Web Game.
Built with Node.js, Socket.io, and Vanilla JS.

## Features
- **Real-time Multiplayer**: Play against friends instantly.
- **Room-based Matchmaking**: Create or join specific rooms.
- **3D Dice Animations**: CSS-only 3D rolling animations.
- **Server-Authoritative Logic**: Prevents cheating.
- **Responsive Design**: Works in Discord Mobile and Desktop.

## Deployment

This project is ready to be deployed on platforms like **Render**, **Railway**, **Glitch**, or **Heroku**.

### Deploying on Render / Railway
1. Push this code to a GitHub repository.
2. Connect your repository to Render/Railway.
3. The build command will be `npm install`.
4. The start command will be `npm start`.
5. Ensure the environment variable `PORT` is handled (the code handles `process.env.PORT`).

## Local Development

1. Install dependencies:
   ```bash
   npm install
   ```
2. Start the server:
   ```bash
   npm start
   ```
3. Open `http://localhost:3000` in multiple browser tabs to test.

## How to Play
1. **Host**: proper name + room code -> "Join Game".
2. **Guest**: proper name + same room code -> "Join Game".
3. The game starts automatically when 2 players are in the room.

## Activity Setup (Discord)
To run this as a Discord Activity:
1. Create a Discord Application in the [Discord Developer Portal](https://discord.com/developers/applications).
2. Set the "Interaction Endpoint URL" or enable "Activities".
3. Use the URL of your deployed web app as the "URL Mapping" for the Activity.

## Troubleshooting

### Cloudflare Captcha / Infinite Loading
If you use Cloudflare and users get stuck on "Verify you are human":
1.  Go to **Cloudflare Dashboard > Security > Settings**.
2.  Set **Security Level** to **Essentially Off**.
3.  Go to **Security > Bots** and disable **Bot Fight Mode**.
4.  Discord's embedded browser is often mistaken for a bot; lowering these settings usually fixes it.
