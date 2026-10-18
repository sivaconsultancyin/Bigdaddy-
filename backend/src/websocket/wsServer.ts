import { WebSocketServer, WebSocket } from 'ws';
import { Server as HttpServer } from 'http';
import { aviatorEngine } from '../games/aviator/aviator.engine';
import { rouletteEngine } from '../games/roulette/roulette.engine';
import { andarBaharEngine } from '../games/andar-bahar/andar-bahar.engine';
import { dragonTigerEngine } from '../games/dragon-tiger/dragon-tiger.engine';
import { diceEngine } from '../games/dice/dice.engine';

export function setupWebSocketServer(server: HttpServer) {
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws: WebSocket) => {
    // Send immediate current state for all active multiplayer casino games
    ws.send(
      JSON.stringify({
        event: 'connected',
        data: {
          timestamp: Date.now(),
          round: aviatorEngine.getPublicRoundState(),
          history: aviatorEngine.getHistory(),
          rouletteRound: rouletteEngine.getPublicRoundState(),
          rouletteHistory: rouletteEngine.getHistory(),
          rouletteBets: rouletteEngine.getCurrentRoundBets(),
          andarBaharRound: andarBaharEngine.getPublicRoundState(),
          andarBaharHistory: andarBaharEngine.getHistory(),
          andarBaharBets: andarBaharEngine.getCurrentRoundBets(),
          dragonTigerRound: dragonTigerEngine.getPublicRoundState(),
          dragonTigerHistory: dragonTigerEngine.getHistory(),
          dragonTigerBets: dragonTigerEngine.getCurrentRoundBets(),
          diceRound: diceEngine.getPublicRoundState(),
          diceHistory: diceEngine.getHistory(),
          diceBets: diceEngine.getCurrentRoundBets(),
        },
      })
    );

    ws.on('message', (message: string) => {
      try {
        const parsed = JSON.parse(message.toString());
        if (parsed.action === 'ping') {
          ws.send(JSON.stringify({ event: 'pong', timestamp: Date.now() }));
        }
      } catch (e) {
        // Ignore malformed client message
      }
    });
  });

  // Connect authoritative Aviator game engine events to connected clients
  aviatorEngine.subscribe((event: string, data: any) => {
    const payload = JSON.stringify({ event, data });
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  });

  // Connect authoritative European Roulette game engine events to connected clients
  rouletteEngine.subscribe((event: string, data: any) => {
    const payload = JSON.stringify({ event, data });
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  });

  // Connect authoritative Andar Bahar game engine events to connected clients
  andarBaharEngine.subscribe((event: string, data: any) => {
    const payload = JSON.stringify({ event, data });
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  });

  // Connect authoritative Dragon Tiger game engine events to connected clients
  dragonTigerEngine.subscribe((event: string, data: any) => {
    const payload = JSON.stringify({ event, data });
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  });

  // Connect authoritative Lucky 10 Dice game engine events to connected clients
  diceEngine.subscribe((event: string, data: any) => {
    const payload = JSON.stringify({ event, data });
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  });

  return wss;
}
