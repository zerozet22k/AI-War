import type { ClientMessage, ServerMessage } from './protocol';

export interface MultiplayerClientHandlers {
  onMessage: (msg: ServerMessage) => void;
  onClose: () => void;
  onError?: (message: string) => void;
}

/** Thin WebSocket wrapper — connects, sends typed protocol messages, and
 * forwards parsed server messages to a handler. No reconnection logic in
 * this pass: a dropped connection just calls onClose. */
export class MultiplayerClient {
  private socket: WebSocket | null = null;

  connect(url: string, handlers: MultiplayerClientHandlers): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url);
      this.socket = socket;

      socket.onopen = () => resolve();
      socket.onerror = () => {
        handlers.onError?.('Could not reach the multiplayer server.');
        reject(new Error('WebSocket connection failed'));
      };
      socket.onclose = () => handlers.onClose();
      socket.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data) as ServerMessage;
          handlers.onMessage(msg);
        } catch {
          handlers.onError?.('Received a malformed message from the server.');
        }
      };
    });
  }

  send(msg: ClientMessage): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(msg));
    }
  }

  disconnect(): void {
    this.socket?.close();
    this.socket = null;
  }
}
