/**
 * 大老二核心規則引擎 (Big Two Rule Engine)
 * 權重設計：
 * 點數 (Point): 3=0, 4=1, ..., A=11, 2=12
 * 花色 (Suit): ♣=0, ♦=1, ♥=2, ♠=3
 */
const BigTwoRule = {
    // 取得點數 (0-12)
    getPoint: (id) => Math.floor(id / 4),
    // 取得花色 (0-3)
    getSuit: (id) => id % 4,

    /**
     * 牌型分析
     */
    analyze: (cards) => {
        if (!cards || cards.length === 0) return null;
        
        const n = cards.length;
        const sorted = [...cards].sort((a, b) => a - b);
        const pts = sorted.map(c => BigTwoRule.getPoint(c));
        const suits = sorted.map(c => BigTwoRule.getSuit(c));
        
        // 最大的一張牌作為 Power 判定依據
        const highestCard = sorted[n - 1];

        // 單張
        if (n === 1) {
            return { type: 'SINGLE', power: highestCard, name: '單張', rank: 1 };
        }

        // 對子
        if (n === 2) {
            if (pts[0] === pts[1]) {
                return { type: 'PAIR', power: highestCard, name: '對子', rank: 1 };
            }
        }

        // 五張牌系列
        if (n === 5) {
            const isFlush = suits.every(s => s === suits[0]);
            
            // 處理順子 (包含 2-3-4-5-6 這種特殊順子邏輯)
            // 這裡採用最簡化的連續點數判斷
            const isStraight = pts.every((p, i) => i === 0 || p === pts[i - 1] + 1);

            // 同花順
            if (isFlush && isStraight) {
                return { type: 'STR_FLUSH', power: highestCard, name: '同花順', rank: 5 };
            }

            // 鐵支 (4+1)
            if (pts[0] === pts[3] || pts[1] === pts[4]) {
                // 鐵支的強度看中間那一張（那張一定是四張點數之一）
                return { type: 'FOUR_KIND', power: sorted[2], name: '鐵支', rank: 4 };
            }

            // 葫蘆 (3+2)
            if ((pts[0] === pts[2] && pts[3] === pts[4]) || (pts[0] === pts[1] && pts[2] === pts[4])) {
                // 葫蘆的強度看三張的那組，中間那張一定是三張點數之一
                return { type: 'FULL_HOUSE', power: sorted[2], name: '葫蘆', rank: 3 };
            }

            // 同花
            if (isFlush) {
                return { type: 'FLUSH', power: highestCard, name: '同花', rank: 2 };
            }

            // 順子
            if (isStraight) {
                return { type: 'STRAIGHT', power: highestCard, name: '順子', rank: 1 };
            }
        }

        return null; // 不合法牌型
    },

    /**
     * 比牌邏輯
     * @param {Array} newCards - 玩家想出的牌
     * @param {Array} lastMove - 桌面上的牌
     * @param {Boolean} isFirstTurn - 是否為梅花 3 的首回合
     */
    compare: (newCards, lastMove, isFirstTurn) => {
        const newInfo = BigTwoRule.analyze(newCards);
        
        // 1. 必須是合法牌型
        if (!newInfo) return { valid: false, msg: '這不是有效的牌型' };

        // 2. 首回合檢查：必須包含梅花 3 (ID: 0)
        if (isFirstTurn && !newCards.includes(0)) {
            return { valid: false, msg: '首回合必須打出梅花 3' };
        }

        // 3. 自由出牌 (桌面上沒牌)
        if (!lastMove || lastMove.length === 0) {
            return { valid: true, info: newInfo };
        }

        const lastInfo = BigTwoRule.analyze(lastMove);

        // 4. 張數必須相同 (除非是 5 張牌系列可以大過小牌型，但大老二規則通常要求張數相同)
        if (newCards.length !== lastMove.length) {
            return { valid: false, msg: '張數必須與桌面相同' };
        }

        // 5. 相同牌型比點數+花色
        if (newInfo.type === lastInfo.type) {
            if (newInfo.power > lastInfo.power) {
                return { valid: true, info: newInfo };
            } else {
                return { valid: false, msg: '點數不夠大' };
            }
        }

        // 6. 5 張牌的不同種類比 rank (順子 < 同花 < 葫蘆 < 鐵支 < 同花順)
        if (newCards.length === 5) {
            if (newInfo.rank > lastInfo.rank) {
                return { valid: true, info: newInfo };
            } else if (newInfo.rank === lastInfo.rank) {
                // 等級相同比最大張
                return newInfo.power > lastInfo.power ? { valid: true, info: newInfo } : { valid: false, msg: '同牌型但點數較小' };
            }
        }

        return { valid: false, msg: '牌型不相符' };
    },

    /**
     * 輔助功能：從手牌中尋找所有對子 (用於智慧選牌)
     */
    findPairs: (hand) => {
        let pairs = [];
        const groups = BigTwoRule.groupByPoint(hand);
        for (let p in groups) {
            if (groups[p].length >= 2) {
                // 這裡可以產生多種對子組合，簡單起見取前兩個
                pairs.push(groups[p].slice(0, 2));
            }
        }
        return pairs;
    },

    /**
     * 輔助功能：點數分類
     */
    groupByPoint: (hand) => {
        return hand.reduce((acc, card) => {
            const p = BigTwoRule.getPoint(card);
            if (!acc[p]) acc[p] = [];
            acc[p].push(card);
            return acc;
        }, {});
    },

    /**
     * 輔助功能：尋找所有葫蘆
     */
    findFullHouses: (hand) => {
        let results = [];
        const groups = BigTwoRule.groupByPoint(hand);
        const threes = Object.values(groups).filter(g => g.length >= 3);
        const pairs = Object.values(groups).filter(g => g.length >= 2);

        threes.forEach(t => {
            pairs.forEach(p => {
                if (BigTwoRule.getPoint(t[0]) !== BigTwoRule.getPoint(p[0])) {
                    results.push([...t.slice(0, 3), ...p.slice(0, 2)]);
                }
            });
        });
        return results;
    }
};