const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const os = require('os');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(path.join(__dirname, 'public')));

// 房間資料庫
let rooms = {};
const AVATARS = ['👑', '🛡️', '⚔️', '💎', '🔥', '🌀', '🎭', '🃏'];

/**
 * 獲取區域網路 IP 用於行動裝置連線
 */
function getLocalIP() {
    const interfaces = os.networkInterfaces();
    for (let devName in interfaces) {
        const iface = interfaces[devName];
        for (let i = 0; i < iface.length; i++) {
            const alias = iface[i];
            if (alias.family === 'IPv4' && alias.address !== '127.0.0.1' && !alias.internal) {
                return alias.address;
            }
        }
    }
    return 'localhost';
}

io.on('connection', (socket) => {
    console.log(`[SYS] Player Connected: ${socket.id}`);

    // 加入/創建房間
    socket.on('joinRoom', ({ roomId, username, password, action }) => {
        // 驗證房間狀態
        if (action === 'create' && rooms[roomId]) {
            return socket.emit('errorMsg', '房間號碼已被佔用，請換一個');
        }
        if (action === 'join' && !rooms[roomId]) {
            return socket.emit('errorMsg', '找不到該房間，請檢查房號');
        }

        if (!rooms[roomId]) {
            rooms[roomId] = {
                id: roomId,
                players: [],
                status: 'waiting', // waiting, playing, ended
                lastMove: null,
                turn: 0,
                passCount: 0,
                firstTurn: true,
                ownerId: socket.id,
                password: password || null,
                logs: [`房間 ${roomId} 由系統初始化完成`],
                createdAt: new Date(),
                settings: {
                    autoStart: false,
                    isPrivate: !!password
                }
            };
        }

        const room = rooms[roomId];

        if (room.status === 'playing' && room.players.length >= 4) {
            return socket.emit('errorMsg', '對局進行中，且人數已滿');
        }
        if (room.password && room.password !== password) {
            return socket.emit('errorMsg', '密碼不正確');
        }

        const newUser = {
            id: socket.id,
            username: username || `玩家_${socket.id.substring(0, 4)}`,
            avatar: AVATARS[room.players.length % 8],
            cardsCount: 0,
            pass: false,
            score: 0,
            isReady: false,
            isOwner: socket.id === room.ownerId
        };

        room.players.push(newUser);
        socket.join(roomId);
        room.logs.push(`[系統] ${newUser.username} 踏入了戰場`);
        
        io.to(roomId).emit('roomUpdate', { room });
        console.log(`[ROOM] ${username} joined ${roomId}`);
    });

    // 開始對局
    socket.on('startGame', (roomId) => {
        const room = rooms[roomId];
        if (!room || room.ownerId !== socket.id) return;
        if (room.players.length < 2) return socket.emit('errorMsg', '至少需要 2 名玩家才能開始');

        room.status = 'playing';
        room.lastMove = null;
        room.passCount = 0;
        room.firstTurn = true;
        room.logs.push("—— 戰鬥開始，梅花 3 先行 ——");

        // 52 張牌洗牌
        let deck = Array.from({ length: 52 }, (_, i) => i);
        for (let i = deck.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [deck[i], deck[j]] = [deck[j], deck[i]];
        }

        const per = Math.floor(52 / room.players.length);
        room.players.forEach((p, i) => {
            const myCards = deck.slice(i * per, (i + 1) * per).sort((a, b) => a - b);
            p.cardsCount = myCards.length;
            p.pass = false;
            io.to(p.id).emit('getCards', myCards);
            
            // 決定誰有梅花 3 (ID: 0)
            if (myCards.includes(0)) room.turn = i;
        });

        io.to(roomId).emit('gameUpdate', room);
    });

    // 出牌邏輯
    socket.on('play', ({ roomId, cards, typeName }) => {
        const room = rooms[roomId];
        if (!room || room.status !== 'playing') return;

        const player = room.players[room.turn];
        if (player.id !== socket.id) return;

        room.lastMove = cards;
        room.passCount = 0;
        room.firstTurn = false;
        
        // 重設所有人的 Pass 狀態
        room.players.forEach(p => p.pass = false);
        
        player.cardsCount -= cards.length;
        room.logs.push(`${player.username} 打出了 [${typeName}]`);

        // 檢查勝負
        if (player.cardsCount === 0) {
            room.status = 'ended';
            room.logs.push(`🏆 勝利者是 ${player.username}！對局結束。`);
            
            // 計算結算分數
            room.players.forEach(p => {
                let penalty = p.cardsCount;
                if (penalty >= 10) penalty *= 2;
                if (penalty === 13) penalty *= 3;
                p.score -= penalty;
            });
            player.score += 20; // 贏家加分
        } else {
            room.turn = (room.turn + 1) % room.players.length;
        }

        io.to(roomId).emit('gameUpdate', room);
    });

    // 跳過邏輯
    socket.on('pass', (roomId) => {
        const room = rooms[roomId];
        if (!room || room.status !== 'playing') return;

        const player = room.players[room.turn];
        if (player.id !== socket.id) return;

        player.pass = true;
        room.passCount++;
        room.logs.push(`${player.username} 選擇 Pass`);

        room.turn = (room.turn + 1) % room.players.length;

        // 如果除了出牌者外大家都 Pass
        if (room.passCount >= room.players.length - 1) {
            room.lastMove = null;
            room.passCount = 0;
            room.players.forEach(p => p.pass = false);
            room.logs.push(`—— 新的一輪開始，由 ${room.players[room.turn].username} 取得牌權 ——`);
        }

        io.to(roomId).emit('gameUpdate', room);
    });

    // 斷線處理
    socket.on('disconnect', () => {
        for (let rid in rooms) {
            const room = rooms[rid];
            const pIdx = room.players.findIndex(p => p.id === socket.id);
            if (pIdx !== -1) {
                const leaver = room.players[pIdx];
                room.logs.push(`[警告] ${leaver.username} 中途撤退`);
                room.players.splice(pIdx, 1);

                if (room.players.length === 0) {
                    delete rooms[rid];
                } else {
                    // 如果房主離開，移交權限
                    if (socket.id === room.ownerId) {
                        room.ownerId = room.players[0].id;
                        room.players[0].isOwner = true;
                        room.logs.push(`[系統] 權限已移交給 ${room.players[0].username}`);
                    }
                    io.to(rid).emit('roomUpdate', { room });
                }
                break;
            }
        }
    });
});

const PORT = 3000;
const IP = getLocalIP();
server.listen(PORT, '0.0.0.0', () => {
    console.log(`
    ┌──────────────────────────────────────────┐
    │  BIG TWO PRO - ADVANCED SERVER STARTED   │
    ├──────────────────────────────────────────┤
    │  Local:   http://localhost:${PORT}       │
    │  Network: http://${IP}:${PORT}           │
    └──────────────────────────────────────────┘
    `);
});