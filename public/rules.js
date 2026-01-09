export const DEFAULT_RULES = {
    // Scoring Values
    single1: 100,
    single5: 50,
    triple1: 1000,
    triple2: 200,
    triple3: 300,
    triple4: 400,
    triple5: 500,
    triple6: 600,
    straight: 1500,
    threePairs: 1500,
    fourOfAKind: 1000,
    fiveOfAKind: 2000,
    sixOfAKind: 3000,
    sixOnes: 5000, // 1-1-1-1-1-1
    twoTriplets: 2500,
    fullHouseBonus: 250, // 3-of-kind + pair
    fourStraight: 500, // Custom
    fiveStraight: 1200, // Custom

    // Feature Toggles (Game Modes/Variants can override these)
    enableThreePairs: false,
    enableTwoTriplets: false,
    enableFullHouse: false, // Not standard-standard, but requested. User said '3-of-a-kind + pair 3-of-a-kind value + 250'
    enableSixOnesInstantWin: false, // User mentioned 'Instant win' as option
    enable4Straight: false,
    enable5Straight: false,

    // Logic Variants
    openingScore: 0, // Minimum to get on board
    winScore: 10000,
    threeFarklesPenalty: 1000,
    toxicTwos: false, // 4+ twos = 0 score for turn
    welfareMode: false, // 10k exact, overflow goes to low score
    highStakes: false, // Can roll previous player's dice
    noFarkleFirstRoll: true // House rule
};

export function calculateScore(dice, rules = DEFAULT_RULES) {
    if (!dice || dice.length === 0) return 0;

    const counts = {};
    for (const die of dice) {
        counts[die] = (counts[die] || 0) + 1;
    }
    const distinct = Object.keys(counts).length;

    // --- Special Combinations (Check these first if dice.length matches) ---
    const totalDice = dice.length;

    // 1. Straight (1-6)
    if (totalDice === 6 && distinct === 6) {
        return rules.straight;
    }

    // 2. 1-1-1-1-1-1 (Six Ones)
    if (counts[1] === 6) {
        return rules.sixOnes;
    }

    // 3. Six of a Kind
    for (let i = 2; i <= 6; i++) {
        if (counts[i] === 6) return rules.sixOfAKind;
    }

    // 4. 5-Straight (12345 or 23456)
    if (rules.enable5Straight && totalDice === 5 && distinct === 5) {
        // Check for 1-5 straight (no 6) or 2-6 straight (no 1)
        if ((counts[1] && counts[2] && counts[3] && counts[4] && counts[5] && !counts[6]) ||
            (counts[2] && counts[3] && counts[4] && counts[5] && counts[6] && !counts[1])) {
            return rules.fiveStraight;
        }
    }

    // 5. 4-Straight (1234, 2345, 3456)
    if (rules.enable4Straight && totalDice === 4 && distinct === 4) {
        const has1234 = (counts[1] && counts[2] && counts[3] && counts[4] && !counts[5] && !counts[6]);
        const has2345 = (counts[2] && counts[3] && counts[4] && counts[5] && !counts[1] && !counts[6]);
        const has3456 = (counts[3] && counts[4] && counts[5] && counts[6] && !counts[1] && !counts[2]);
        if (has1234 || has2345 || has3456) return rules.fourStraight;
    }

    // 6. Three Pairs
    if (rules.enableThreePairs && totalDice === 6 && distinct === 3) {
        // Check if all counts are 2
        const isThreePairs = Object.values(counts).every(c => c === 2);
        if (isThreePairs) return rules.threePairs;
    }
    // Also check 4+2 (Four of kind + pair is essentially a pair + 4k, but strictly 3 pairs implies distinct pairs usually)
    // The prompt says '3 Pairs'. Usually 2-2, 3-3, 4-4.

    // 5. Two Triplets
    if (rules.enableTwoTriplets && totalDice === 6 && distinct === 2) {
        const vals = Object.values(counts);
        if (vals[0] === 3 && vals[1] === 3) return rules.twoTriplets;
    }

    // --- Standard Counting Score ---
    let score = 0;

    for (let face = 1; face <= 6; face++) {
        const count = counts[face] || 0;
        if (count === 0) continue;

        let tripleValue = 0;
        switch (face) {
            case 1: tripleValue = rules.triple1; break;
            case 2: tripleValue = rules.triple2; break;
            case 3: tripleValue = rules.triple3; break;
            case 4: tripleValue = rules.triple4; break;
            case 5: tripleValue = rules.triple5; break;
            case 6: tripleValue = rules.triple6; break;
        }

        if (count >= 3) {
            // N-of-a-kind logic
            if (count === 3) {
                score += tripleValue;
            } else if (count === 4) {
                // User requested 4 ones = 2000. 
                // Standard variant: 4-of-a-kind is 2x 3-of-a-kind.
                score += tripleValue * 2;
            } else if (count === 5) {
                // Standard variant: 5-of-a-kind is 3x 3-of-a-kind (or 4x? or 2x 4-kind?)
                // Let's go with 3x (3000 for 1s) or 4x (4000)?
                // Usually it keeps doubling: 1000 -> 2000 -> 4000 -> 8000
                // Or linear: 1000 -> 2000 -> 3000
                // Given "4 is 2000", doubling seems safest for high stakes feel.
                score += tripleValue * 4;
            } else if (count === 6) {
                // 6-of-a-kind is usually instant win or 3000 flat rule, 
                // but if we fall through here (no rule.sixOfAKind matched earlier??)
                // Actually rule.sixOfAKind (3000) is checked at the TOP.
                // So we likely won't reach here for count 6 unless distinct != 1??
                // Wait, distinct check loops faces. If count[face] == 6, distinct IS 1.
                // The top check `if (counts[i] === 6) return rules.sixOfAKind;` handles it.
                // So this block is redundant for 6, but good for safety.
                score += tripleValue * 8;
            }
        } else {
            if (face === 1) score += count * rules.single1;
            else if (face === 5) score += count * rules.single5;
        }
    }
    return score;

}

export function hasPossibleMoves(dice, rules = DEFAULT_RULES) {
    if (!dice || dice.length === 0) return false;

    // Check simple scorers
    const counts = {};
    for (const d of dice) counts[d] = (counts[d] || 0) + 1;

    if (counts[1] > 0 || counts[5] > 0) return true;

    // Triples
    for (let i = 1; i <= 6; i++) {
        if (counts[i] >= 3) return true;
    }

    // Straight?
    if (Object.keys(counts).length === 6) return true; // 1-2-3-4-5-6

    // 3 Pairs?
    if (rules.enableThreePairs && dice.length === 6) {
        if (Object.values(counts).every(c => c === 2)) return true;
    }

    // 5 Straight check (if we have 5 dice)
    if (rules.enable5Straight && dice.length >= 5) {
        const has12345 = (counts[1] && counts[2] && counts[3] && counts[4] && counts[5]);
        const has23456 = (counts[2] && counts[3] && counts[4] && counts[5] && counts[6]);
        if (has12345 || has23456) return true;
    }

    // 4 Straight check (if we have 4 dice)
    if (rules.enable4Straight && dice.length >= 4) {
        const has1234 = (counts[1] && counts[2] && counts[3] && counts[4]);
        const has2345 = (counts[2] && counts[3] && counts[4] && counts[5]);
        const has3456 = (counts[3] && counts[4] && counts[5] && counts[6]);
        if (has1234 || has2345 || has3456) return true;
    }

    return false;
}

export function isScoringSelection(dice, rules = DEFAULT_RULES) {
    // A selection is valid if the WHOLE set produces a score > 0 
    // AND every die contributes? 
    // (Previous implementation checked for non-contributing dice).
    // With complex rules, specific subsets (like 2,2,2) require all 3.
    // 2,2 is invalid.
    // 1,2 is invalid (2 doesn't score).

    // We can simply check: calculateScore(dice) > 0?
    // AND calculateScore(dice_minus_one) < calculateScore(dice)? 
    // Checking contribution is expensive for every subset.

    // Robust check:
    // Filter out known junk?
    // If we have 2,3,4,6 present, they MUST be part of a set (Triple, Straight, etc).
    // If we have a 2, and count[2] < 3, and it's not a Straight/3Pairs, it's junk.

    const score = calculateScore(dice, rules);
    if (score === 0) return false;

    // Check for non-contributing dice (simplified)
    const counts = {};
    for (const d of dice) counts[d] = (counts[d] || 0) + 1;

    // If straight, all contribute.
    if (dice.length === 6 && Object.keys(counts).length === 6) return true;

    // If 3 pairs, all contribute.
    if (rules.enableThreePairs && dice.length === 6 && Object.values(counts).every(c => c === 2)) return true;

    // 5 Straight (1-5 or 2-6)
    if (rules.enable5Straight && dice.length === 5 && Object.keys(counts).length === 5) {
        if (!counts[6] || !counts[1]) return true;
    }

    // 4 Straight (1-4, 2-5, 3-6)
    if (rules.enable4Straight && dice.length === 4 && Object.keys(counts).length === 4) {
        const has1234 = (counts[1] && counts[2] && counts[3] && counts[4]);
        const has2345 = (counts[2] && counts[3] && counts[4] && counts[5]);
        const has3456 = (counts[3] && counts[4] && counts[5] && counts[6]);
        if (has1234 || has2345 || has3456) return true;
    }

    // Check individual faces
    for (let face = 1; face <= 6; face++) {
        const c = counts[face] || 0;
        if (c > 0) {
            // 1s and 5s always contribute (as singles or part of sets)
            if (face === 1 || face === 5) continue;

            // Others must be >= 3 to contribute
            if (c < 3) return false;
        }
    }

    return true;
}

