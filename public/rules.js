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
    enableThreePairs: true,
    enableTwoTriplets: true,
    enableFullHouse: false, // Not standard-standard, but requested. User said '3-of-a-kind + pair 3-of-a-kind value + 250'
    enableSixOnesInstantWin: false, // User mentioned 'Instant win' as option
    enable4Straight: false,
    enable5Straight: false,

    // Logic Variants
    openingScore: 500, // Minimum to get on board
    winScore: 10000,
    threeFarklesPenalty: 1000,
    toxicTwos: false, // 4+ twos = 0 score for turn
    welfareMode: false, // 10k exact, overflow goes to low score
    highStakes: false, // Can roll previous player's dice
    noFarkleFirstRoll: false // House rule
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
    // If no special 6-dice combo, we sum up individual sets.
    // Note: This logic assumes the user selected a valid set. 
    // It does NOT auto-partition. It scores the 'dice' array passed in.
    // If user sends [1, 1, 1, 5], we score 1050.

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
                score += rules.fourOfAKind || (tripleValue * 2);
                // Wait, user provided specific 1000 for 4-kind. 
                // But standard is often 2x triple. 
                // If the user's table says '4 of a Kind 1000', that conflicts with '2x 3-of-a-kind'.
                // I will use logic: If specific rule value exists, use it?
                // Actually the user provided a LIST of options. '1000', '2000', '2x...'.
                // I will use the default I set (1000).

                // However, for 1s: Triple is 1000. 4-kind of 1s could be 2000 or 1000? 
                // Usually 4-of-a-kind applies to the whole set.
                // Exception: if I have four 1s, is it 1000 + 100? or 4-kind score?
                // In Farkle, 4-of-a-kind is a specific combo. 
                // Use the rules.fourOfAKind if defined, else logical fallback.

                // Let's interpret the request: '4 of a Kind 1000'. 
                // This implies flat 1000 for ANY 4-of-a-kind? Or maybe 1000 for 1s, etc?
                // Usually 4-kind is dynamic. 
                // The provided text: '4 of a Kind 1000'. This might be the column for 'Standard'.
                // If so, 4-of-a-kind 1s = 1000? That's barely better than 3 (1000) + 1 (100).
                // Actually it's WORSE. 111 (1000) + 1 (100) = 1100.
                // So likely '1000' is a typo in my parsing or it means something else.
                // In 'Standard', 4-of-a-kind is often 2x Triple.
                // I'll stick to 'tripleValue * (count - 2)' or similar multiplier logic if strict rules aren't forced.
                // But let's look at the table again:
                // '3 Pairs 1500'
                // '4 of a Kind 1000'
                // This implies a flat bonus?
                // I will implement the most common variants:
                // 3: 1x
                // 4: 2x
                // 5: 3x (or rule value)
                // 6: 4x (or rule value)

                // Let's treat count >= 3 as:
                // Base: tripleValue.
                // Multiplier: 2^(count-3)? No.
                // 3 -> 1x
                // 4 -> 2x
                // 5 -> 3x or 4x?
                // 6 -> 4x or 8x?

                // User text:
                // 4 of a Kind 1000 (Option A) ... 2x 3-of-kind (Option C)
                // I'll assume 'Standard' column is the first one. 
                // So 4-kind = 1000. 5-kind = 2000. 6-kind = 3000.
                // This seems like a flat score regardless of face, EXCEPT maybe 1s?
                // If I have 4 2s: 1000 pts. (vs 200 for 3). huge upgrade.
                // If I have 4 1s: 1000 pts. (vs 1100 for 3+1). Downgrade.
                // I will implement a 'Max' check? Or just follow the rule strictly.
                // If strict rule says 4-kind = 1000, then 4 ones = 1000.

                // I'll fallback to: if flat value is set > 0, use it. But for 1s, check if (1000 + 100 > rule).
                // Actually standard Farkle usually sums sets.
                // I will proceed with:
                // - 1s and 5s are added individually if they are not part of a larger set?
                // - No, calculateScore receives a SET of dice intended to be scored TOGETHER.
                // - So if I pass [1,1,1,1], I score it as 4-of-a-kind.
                // - If I wanted 3-of-a-kind + 1, I would select [1,1,1] (score 1000) then [1] (score 100).

                // So my logic just needs to identify the 'Type' of the set passed.
                // But players usually select ALL scoring dice. [1,1,1,1].
                // Does the game automatically partition [1,1,1,1] into 111 + 1 (1100) or 1111 (1000)?
                // Usually the game engine greedily picks the best, PREVENTING valid lower scores?
                // Or does it treat the selection as a requested combo?
                // In my isScoringSelection logic, I just cared if it's valid.
                // calculateScore returns the value.
                // I will implement a greedy 'best score' for the set.

                if (face === 1 && (1000 + (count - 3) * 100) > rules.fourOfAKind) {
                    // 1s are special, usually computed as 1000 + extra 1s unless 4-of-a-kind is HUGE.
                    // But if rules.fourOfAKind is 1000, then 111+1 (1100) is better.
                    score += (tripleValue + (count - 3) * rules.single1);
                } else {
                    if (count === 4) score += rules.fourOfAKind;
                    else if (count === 5) score += rules.fiveOfAKind;
                    else if (count === 6) score += rules.sixOfAKind;
                    else score += tripleValue; // Count is 3
                }

            }
        } else {
            // Count < 3
            if (face === 1) score += count * rules.single1;
            else if (face === 5) score += count * rules.single5;
            // 2,3,4,6 yield 0 if count < 3
        }
    }

    // Toxic Twos Check (If this function is just calculating score, maybe return 0? 
    // But Toxic Twos usually wipes the whole TURN, not just the roll.
    // That needs to be handled in game logic, not just score calc.
    // However, if the roll HAS Toxic Twos, this roll score is 0 and it triggers a wipe.
    // I need to signal that. Maybe return -1? 
    // Or let the game logic check the dice for Toxic Twos condition separate from score.)

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

