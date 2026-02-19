const socket = io();

// 全局常數
const POINTS = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2'];
const SUITS = ['♣', '♦', '♥', '♠'];

// 遊戲狀態
let state = {
    room: null,
    myHand: [],
    selectedCards: [],
    isMyTurn: false,
    smartSearch: {
        type: '',
        index: 0,
        results: []
    }
};

/**
 * 認證與登入
 */
function handleAuth(action) {
    const roomId = document.getElementById('rid').value.trim();
    const username = document.getElementById('nick').value.trim();
    const password = document.getElementById('pwd').value;

    if (!roomId || !username) return alert('請填寫完整資訊');

    socket.emit('joinRoom', { roomId, username, password, action });
}

// --- Socket 監聽 ---

socket.on('roomUpdate', ({ room }) => {
    state.room = room;
    document.getElementById('lobby').style.display = 'none';
    document.getElementById('app').style.display = 'grid';
    document.getElementById('room-id-display').innerText = room.id;
    refreshUI();
});

socket.on('gameUpdate', (room) => {
    state.room = room;
    const me = room.players.find(p => p.id === socket.id);
    state.isMyTurn = room.players[room.turn].id === socket.id;
    
    // 如果對局剛開始或結束，重置選牌
    if (room.status !== 'playing') state.selectedCards = [];

    refreshUI();
});

socket.on('getCards', (cards) => {
    state.myHand = cards.sort((a, b) => a - b);
    state.selectedCards = [];
    renderHand();
});

socket.on('errorMsg', (msg) => {
    alert(`[發生錯誤] ${msg}`);
});

/**
 * 介面刷新主函數
 */
function refreshUI() {
    const room = state.room;
    if (!room) return;

    // 1. 玩家狀態列表
    const chipContainer = document.getElementById('player-chips');
    chipContainer.innerHTML = room.players.map((p, i) => `
        <div class="p-tag ${room.turn === i && room.status === 'playing' ? 'active' : ''}">
            ${p.isOwner ? '👑 ' : ''}${p.avatar} ${p.username} 
            <small>[${p.cardsCount}]</small> 
            ${p.pass ? '<b style="color:red">PASS</b>' : ''}
        </div>
    `).join('');

    // 2. 對局日誌
    const logBox = document.getElementById('log-list');
    logBox.innerHTML = room.logs.slice(-25).map(l => `<div>${l}</div>`).join('');
    logBox.scrollTop = logBox.scrollHeight;

    // 3. 系統提示
    const hint = document.getElementById('system-hint');
    const startBtn = document.getElementById('start-btn');
    const overlay = document.getElementById('result-overlay');

    if (room.status === 'waiting') {
        hint.innerText = room.ownerId === socket.id ? "你是房主，準備好請開始" : "等待房主啟動戰場...";
        startBtn.style.display = room.ownerId === socket.id ? 'block' : 'none';
        overlay.style.display = 'none';
    } else if (room.status === 'playing') {
        hint.innerText = state.isMyTurn ? "★★★ 輪到你出牌了 ★★★" : "對手思考中...";
        startBtn.style.display = 'none';
        overlay.style.display = 'none';
    } else if (room.status === 'ended') {
        overlay.style.display = 'flex';
        const winner = room.players.find(p => p.cardsCount === 0);
        document.getElementById('winner-text').innerText = `${winner.username} 獲勝！`;
        document.getElementById('retry-btn').style.display = room.ownerId === socket.id ? 'block' : 'none';
    }

    // 4. 按鈕狀態
    document.getElementById('play-btn').disabled = !state.isMyTurn;
    document.getElementById('pass-btn').disabled = !state.isMyTurn || !room.lastMove;

    renderTable();
    renderHand();
}

/**
 * 繪製手牌
 */
function renderHand() {
    const container = document.getElementById('hand-cards');
    container.innerHTML = '';
    
    state.myHand.forEach(id => {
        const cardDiv = createCardElement(id);
        if (state.selectedCards.includes(id)) cardDiv.classList.add('selected');
        
        cardDiv.onclick = () => {
            if (state.selectedCards.includes(id)) {
                state.selectedCards = state.selectedCards.filter(x => x !== id);
            } else {
                state.selectedCards.push(id);
            }
            renderHand();
        };
        container.appendChild(cardDiv);
    });
}

/**
 * 繪製桌面已出的牌
 */
function renderTable() {
    const area = document.getElementById('table-cards');
    const typeLabel = document.getElementById('move-type');
    area.innerHTML = '';
    
    if (state.room.lastMove) {
        state.room.lastMove.forEach(id => {
            area.appendChild(createCardElement(id));
        });
        const info = BigTwoRule.analyze(state.room.lastMove);
        typeLabel.innerText = info ? info.name : '未知牌型';
    } else {
        typeLabel.innerText = '等待出牌';
    }
}

/**
 * 建立卡片 DOM 物件
 */
function createCardElement(id) {
    const div = document.createElement('div');
    const suit = BigTwoRule.getSuit(id);
    const point = BigTwoRule.getPoint(id);
    
    div.className = `poker-card ${suit === 1 || suit === 2 ? 'red' : ''}`;
    div.innerHTML = `
        <span class="val">${POINTS[point]}</span>
        <span class="suit-mini">${SUITS[suit]}</span>
        <span class="suit-big">${SUITS[suit]}</span>
    `;
    return div;
}

/**
 * 智慧選牌：對子、葫蘆等
 */
function smartPick(type) {
    // 如果切換類型，重置索引
    if (state.smartSearch.type !== type) {
        state.smartSearch.type = type;
        state.smartSearch.index = 0;
        
        if (type === 'SINGLE') {
            state.smartSearch.results = state.myHand.map(c => [c]);
        } else if (type === 'PAIR') {
            state.smartSearch.results = BigTwoRule.findPairs(state.myHand);
        } else if (type === 'HOUSE') {
            state.smartSearch.results = BigTwoRule.findFullHouses(state.myHand);
        }
    }

    if (state.smartSearch.results.length > 0) {
        state.selectedCards = state.smartSearch.results[state.smartSearch.index % state.smartSearch.results.length];
        state.smartSearch.index++;
        renderHand();
    }
}

/**
 * 執行出牌
 */
function handlePlay() {
    const res = BigTwoRule.compare(state.selectedCards, state.room.lastMove, state.room.firstTurn);
    
    if (!res.valid) {
        alert(res.msg);
        return;
    }

    socket.emit('play', {
        roomId: state.room.id,
        cards: state.selectedCards,
        typeName: res.info.name
    });

    // 本地先移除牌，增加流暢感
    state.myHand = state.myHand.filter(c => !state.selectedCards.includes(c));
    state.selectedCards = [];
}

function handlePass() {
    socket.emit('pass', state.room.id);
    state.selectedCards = [];
}

function handleStart() {
    socket.emit('startGame', state.room.id);
}

function sortCards() {
    state.myHand.sort((a, b) => a - b);
    renderHand();
}