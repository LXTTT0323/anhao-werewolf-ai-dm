# AnHao - AI Werewolf Moderator

Multiplayer Werewolf for phones: private identities and night actions, host controls, real-time rooms, speech transcription, and AI catch-up summaries in one HTTPS service.

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/LXTTT0323/anhao-werewolf-ai-dm)

## Run locally

```bash
npm install
npm run dev
```

In a second terminal, run `npm run server`. The development site runs on `http://localhost:4173`; the game service runs on port `8787`.

## Deploy on Render

This repository includes `render.yaml`. Create a Render Web Service from the repository and Render will run:

```bash
npm install && npm run build
npm run start
```

Set `OPENAI_API_KEY` only in the Render environment variables. Do not expose it in the browser or commit it to the repository.
