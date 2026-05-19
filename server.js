const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');

app.use(express.static(path.join(__dirname)));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// [핵심 데이터 정의]
let currentRound = 1;
const marketTopic = "B가 A를 이길 것이다"; // 주제 고정

// 판돈을 0으로 리셋하지 않고 계속 누적합니다.
let totalYesBets = 400; 
let totalNoBets = 500;  

// ★ 원래 형식대로 참가자들의 가상 자산과 배팅 내역은 서버에 안전하게 계속 누적됩니다.
let uersData = {}; 

io.on('connection', (socket) => {
    console.log('새로운 참가자 접속:', socket.id);

    // 최초 접속자에게 현재 마켓 상태 및 누적 판돈 전송
    socket.emit('initStatus', {
        round: currentRound,
        topic: marketTopic,
        totalYes: totalYesBets,
        totalNo: totalNoBets
    });

    // 참가자가 배팅을 했을 때 처리하는 로직
    socket.on('placeBet', (data) => {
        const { type, amount, userName } = data;
        const betAmount = parseInt(amount);

        if (isNaN(betAmount) || betAmount <= 0) return;

        // 판돈 누적
        if (type === 'yes') {
            totalYesBets += betAmount;
        } else if (type === 'no') {
            totalNoBets += betAmount;
        }

        // 실시간으로 변동된 총판돈을 모든 참가자에게 즉시 전송
        io.emit('marketUpdate', {
            totalYes: totalYesBets,
            totalNo: totalNoBets
        });
    });

    // [실험 관리자 모드] 다음 라운드 시작 버튼을 눌렀을 때
    socket.on('nextRound', () => {
        currentRound++; // 라운드 숫자만 1씩 증가시킵니다.
        
        // 판돈(totalYesBets, totalNoBets)과 참가자 개인 자산은 절대 리셋(0)하지 않고 그대로 유지합니다.

        // 모든 참가자에게 다음 라운드가 시작되었음을 알림 (누적된 데이터 그대로 들고 감)
        io.emit('roundStarted', {
            round: currentRound,
            topic: marketTopic,
            totalYes: totalYesBets,
            totalNo: totalNoBets
        });
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`서버가 성공적으로 열렸습니다! 포트 번호: ${PORT}`);
});