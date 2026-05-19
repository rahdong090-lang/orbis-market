const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

// 폴리마켓 상태 관리 데이터 (원본 구조 100% 유지)
let marketState = {
    currentRound: 0, 
    topic: "여기에 관리자가 설정한 주제가 표시됩니다.",
    isOrderOpen: false,
    options: {
        A: { name: "찬성 (Yes)", totalBet: 0 },
        B: { name: "반대 (No)", totalBet: 0 }
    }
};

// 실시간 실험용 데이터 저장소 (원본 구조 100% 유지)
let userAssets = {};   
let userBets = {};     
let userNames = {};    
let roundGiven = { 1: false, 2: false, 3: false }; 
let spyClientId = null; 

function calculateOdds() {
    const total = marketState.options.A.totalBet + marketState.options.B.totalBet;
    if (total === 0) return { oddsA: "1.00", oddsB: "1.00", ratioA: "50.0", ratioB: "50.0" };

    const ratioA = ((marketState.options.A.totalBet / total) * 100).toFixed(1);
    const ratioB = (100 - ratioA).toFixed(1);
    
    const oddsA = marketState.options.A.totalBet > 0 ? (total / marketState.options.A.totalBet).toFixed(2) : "1.00";
    const oddsB = marketState.options.B.totalBet > 0 ? (total / marketState.options.B.totalBet).toFixed(2) : "1.00";

    return { oddsA, oddsB, ratioA, ratioB };
}

// 관리자 대시보드 실시간 브로드캐스트 (구조 유지)
function emitAdminDashboard() {
    const count = io.sockets.sockets.size;
    let activeUsersList = [];
    let dashboardData = [];

    for (let id of io.sockets.sockets.keys()) {
        if (userNames[id]) {
            activeUsersList.push({ id: id, name: userNames[id] });
            dashboardData.push({
                id: id,
                name: userNames[id],
                asset: userAssets[id] || 0,
                betA: (userBets[id] && userBets[id].A) ? userBets[id].A : 0,
                betB: (userBets[id] && userBets[id].B) ? userBets[id].B : 0,
                isSpy: (id === spyClientId)
            });
        }
    }
    
    io.emit('user_count_update', { count, activeUsers: activeUsersList });
    io.emit('admin_dashboard_update', dashboardData);
}

// 최종 3라운드 정산 후 순위표 브로드캐스트 🏆 (원본 유지)
function emitFinalLeaderboard() {
    let leaderboard = [];
    for (let id in userNames) {
        leaderboard.push({
            name: userNames[id],
            asset: userAssets[id] || 0
        });
    }
    leaderboard.sort((a, b) => b.asset - a.asset);
    io.emit('final_leaderboard', leaderboard);
}

io.on('connection', (socket) => {
    
    socket.on('register_nickname', (nickname) => {
        if (Object.values(userNames).includes(nickname)) {
            socket.emit('register_result', { success: false, message: '이미 존재하는 닉네임입니다.' });
            return;
        }

        userNames[socket.id] = nickname;
        
        if (userAssets[socket.id] === undefined) {
            userAssets[socket.id] = 0;
        }
        if (!userBets[socket.id]) {
            userBets[socket.id] = { A: 0, B: 0 };
        }

        socket.emit('register_result', { success: true, myAsset: userAssets[socket.id] });
        
        socket.emit('init_data', {
            marketState,
            odds: calculateOdds(),
            myAsset: userAssets[socket.id],
            isSpy: (socket.id === spyClientId)
        });

        emitAdminDashboard();
    });

    socket.on('disconnect', () => {
        if (socket.id === spyClientId) {
            spyClientId = null; 
        }
        delete userNames[socket.id];
        emitAdminDashboard();
    });

    // [관리자] 새로운 예측 주제 등록
    socket.on('admin_set_topic', (data) => {
        marketState.topic = data.topic;
        marketState.options.A.name = data.optA;
        marketState.options.B.name = data.optB;
        marketState.options.A.totalBet = 0;
        marketState.options.B.totalBet = 0;
        marketState.currentRound = 0;
        marketState.isOrderOpen = false;
        
        for (let id in userBets) { userBets[id] = { A: 0, B: 0 }; }
        
        roundGiven = { 1: false, 2: false, 3: false };
        spyClientId = null; 

        io.emit('market_update', { marketState, odds: calculateOdds() });
        io.emit('force_asset_sync', userAssets); 
        io.emit('spy_assigned', null); 
        emitAdminDashboard();
    });

    // [관리자] 스파이 지정
    socket.on('admin_assign_spy', (targetId) => {
        if (!targetId) return;
        spyClientId = targetId;
        
        userAssets[spyClientId] = (userAssets[spyClientId] || 0) * 3;

        io.emit('force_asset_sync', userAssets);
        io.emit('spy_assigned', spyClientId); 
        emitAdminDashboard();
    });

    // [관리자] 라운드 제어 및 보조금 지급
    socket.on('admin_change_round', (data) => {
        const nextRound = parseInt(data.round);
        marketState.currentRound = nextRound;
        marketState.isOrderOpen = data.isOpen;

        if (data.isOpen && !roundGiven[nextRound]) {
            let baseMoney = 0;
            if (nextRound === 1) baseMoney = 3000;
            else if (nextRound === 2) baseMoney = 3000;
            else if (nextRound === 3) baseMoney = 4000;

            if (baseMoney > 0) {
                for (let id in userNames) {
                    const multiplier = (id === spyClientId) ? 3 : 1;
                    const finalAddition = baseMoney * multiplier;
                    userAssets[id] = (userAssets[id] || 0) + finalAddition;
                }
                roundGiven[nextRound] = true; 
            }
        }

        io.emit('market_update', { marketState, odds: calculateOdds() });
        io.emit('force_asset_sync', userAssets); 
        emitAdminDashboard();
    });

    // [관리자] 결과 정산 및 배당금 지급 (판돈 유지 기능)
    socket.on('admin_settle', (winningOption) => {
        const odds = calculateOdds();
        const winOdds = parseFloat(winningOption === 'A' ? odds.oddsA : odds.oddsB);
        const settledRound = marketState.options;
        
        for (let id in userBets) {
            const betAmount = userBets[id][winningOption]; 
            if (betAmount > 0) {
                const reward = Math.floor(betAmount * winOdds);
                userAssets[id] += reward; 
            }
        }

        const currentRoundBeforeSettle = marketState.currentRound;

        // ★ [판돈 및 배당률 유지]: 연속 라운드 거래를 위해 totalBet을 리셋하던 원본 삭제 유지
        // marketState.options.A.totalBet = 0;
        // marketState.options.B.totalBet = 0;
        
        marketState.isOrderOpen = false;
        for (let id in userBets) { userBets[id] = { A: 0, B: 0 }; }

        io.emit('experiment_result', {
            winner: winningOption,
            winnerName: settledRound[winningOption].name,
            finalOdds: winOdds,
            marketState,
            odds: calculateOdds()
        });
        io.emit('force_asset_sync', userAssets);
        emitAdminDashboard();

        if (currentRoundBeforeSettle === 3) {
            emitFinalLeaderboard();
        }
    });

    // [사용자] 베팅 처리 (★ '배팅' ➔ '베팅' 전수 교정 완료)
    socket.on('user_bet', (data) => {
        if (!marketState.isOrderOpen) {
            socket.emit('alert', '현재 라운드 베팅이 닫혀있습니다.');
            return;
        }

        const betAmount = parseInt(data.amount);
        const option = data.option;

        if (isNaN(betAmount) || betAmount <= 0) {
            socket.emit('alert', '올바른 금액을 입력하세요.');
            return;
        }

        if (userAssets[socket.id] < betAmount) {
            socket.emit('alert', '잔액이 부족합니다.');
            return;
        }

        userAssets[socket.id] -= betAmount;
        marketState.options[option].totalBet += betAmount;
        
        if (!userBets[socket.id]) userBets[socket.id] = { A: 0, B: 0 };
        userBets[socket.id][option] += betAmount;

        io.emit('market_update', { marketState, odds: calculateOdds() });
        socket.emit('asset_update', userAssets[socket.id]);
        emitAdminDashboard();
    });
});

const PORT = 3000;
server.listen(PORT, () => {
    console.log(`서버가 성공적으로 열렸습니다! 주소창에 http://localhost:${PORT} 를 입력하세요.`);
});