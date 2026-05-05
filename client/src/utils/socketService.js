import io from 'socket.io-client';

const SERVER_URL = import.meta.env.VITE_API_BASE_URL
  ? import.meta.env.VITE_API_BASE_URL.replace('/api', '')
  : 'https://ziporiteem.com';

class SocketService {
  socket = null;

  connect(userId) {
    if (this.socket && this.socket.connected) return;

    console.log("🔄 Initializing Socket Connection...");
    
    this.socket = io(SERVER_URL, {
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
    });

    this.socket.on('connect', () => {
      console.log('✅ Socket Connected ID:', this.socket.id);
      this.socket.emit('join_chat', userId);
    });

    this.socket.on('reconnect', (attempt) => {
        console.log('🔄 Reconnected, re-joining chat...', attempt);
        this.socket.emit('join_chat', userId);
    });
  }

  // פונקציה להצטרפות לחדר מלון
  joinHotel(hotelId) {
    if (this.socket) {
      this.socket.emit('join_hotel', hotelId);
    }
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }

  // מאפשר שימוש ב-socket.on
  on(eventName, callback) {
    if (this.socket) {
      this.socket.off(eventName);
      this.socket.on(eventName, callback);
    }
  }

  // מאפשר שימוש ב-socket.emit
  emit(eventName, data) {
    if (this.socket) {
      this.socket.emit(eventName, data);
    }
  }

  // מאפשר שימוש ב-socket.off
  off(eventName) {
    if (this.socket) {
      this.socket.off(eventName);
    }
  }
}

const socketService = new SocketService();

// ✨ התיקון הקריטי: ייצוא גם כ-Named Export וגם כ-Default
export const socket = socketService; 
export default socketService;