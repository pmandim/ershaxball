const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
const cors = require('cors');
const path = require('path');
const NodeCache = require('node-cache');

// Load environment variables
dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Serve static files (including HTML)
app.use(express.static(path.join(__dirname, 'public')));

// Initialize Supabase client
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Initialize cache
const cache = new NodeCache({ stdTTL: 7 * 60 }); // 7 minutes TTL
const CACHE_KEY_RANKINGS = 'rankings_pages';
const CACHE_KEY_PLAYER_PROFILES = 'player_profiles';
const CACHE_KEY_ROOM_LINK = 'room_link';
const CACHE_KEY_VIP_STATUS = 'vip_status';

// Function to fetch and cache all rankings pages
async function cacheRankingsData() {
    try {
        const perPage = 250;
        let allRankingsPages = {};

        // Get total count for pagination
        const { count: totalCount, error: countError } = await supabase
            .from('player_stats')
            .select('auth', { count: 'exact', head: true });

        if (countError) {
            console.error('Error fetching total count:', countError);
            return;
        }

        const totalPages = Math.ceil(totalCount / perPage);

        // Fetch all pages
        for (let page = 1; page <= totalPages; page++) {
            const offset = (page - 1) * perPage;

            // Fetch paginated player stats
            const { data: statsData, error: statsError } = await supabase
                .from('player_stats')
                .select('auth, rank, points, games_played, wins, draws, losses, goals, assists, clean_sheets')
                .order('rank', { ascending: true })
                .range(offset, offset + perPage - 1);

            if (statsError) {
                console.error(`Error fetching stats for page ${page}:`, statsError);
                continue;
            }

            // Fetch user data for all auth IDs in this page
            const authIds = statsData.map(stat => stat.auth);
            const { data: userDataRaw, error: userError } = await supabase
                .from('users')
                .select('auth, nicknames')
                .in('auth', authIds);

            if (userError) {
                console.error(`Error fetching user data for page ${page}:`, userError);
                continue;
            }

            const userData = userDataRaw.reduce((acc, user) => {
                acc[user.auth] = user;
                return acc;
            }, {});

            // Store page data
            allRankingsPages[page] = {
                statsData,
                userData,
                pagination: {
                    currentPage: page,
                    perPage,
                    totalItems: totalCount,
                    totalPages
                }
            };
        }

        // Cache the data
        cache.set(CACHE_KEY_RANKINGS, allRankingsPages);
    } catch (err) {
        console.error('Error caching rankings data:', err);
    }
}

// Function to cache player profiles
async function cachePlayerProfiles() {
    try {
        const { data: profiles, error } = await supabase
            .from('player_stats')
            .select('auth, wins, losses, draws, goals, assists, points, games_played, clean_sheets');

        if (error) {
            console.error('Error caching player profiles:', error);
            return;
        }

        const profileMap = profiles.reduce((acc, profile) => {
            acc[profile.auth] = profile;
            return acc;
        }, {});

        cache.set(CACHE_KEY_PLAYER_PROFILES, profileMap);
    } catch (err) {
        console.error('Error caching player profiles:', err);
    }
}

// Function to cache room link
async function cacheRoomLink() {
    try {
        const { data, error } = await supabase
            .from('room_link')
            .select('room_link, total_players, red_players, blue_players, spec_players, blue_score, red_score')
            .eq('id', 1)
            .single();

        if (error) {
            console.error('Error caching room link:', error);
            return;
        }

        cache.set(CACHE_KEY_ROOM_LINK, data);
    } catch (err) {
        console.error('Error caching room link:', err);
    }
}

// Function to cache VIP status
async function cacheVipStatus() {
    try {
        const { data, error } = await supabase
            .from('users')
            .select('auth, isVIP, vip_color, vipMessage, vipCelebration, vip_expires_at');

        if (error) {
            console.error('Error caching VIP status:', error);
            return;
        }

        const vipMap = data.reduce((acc, user) => {
            acc[user.auth] = {
                isVIP: user.isVIP && new Date(user.vip_expires_at) > new Date(),
                vip_color: user.vip_color,
                vipMessage: user.vipMessage,
                vipCelebration: user.vipCelebration
            };
            return acc;
        }, {});

        cache.set(CACHE_KEY_VIP_STATUS, vipMap);
    } catch (err) {
        console.error('Error caching VIP status:', err);
    }
}

// Schedule cache refresh every 7 minutes
setInterval(() => {
    cacheRankingsData();
    cachePlayerProfiles();
    cacheRoomLink();
    cacheVipStatus();
}, 7 * 60 * 1000);

// Initial cache population
cacheRankingsData();
cachePlayerProfiles();
cacheRoomLink();
cacheVipStatus();

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Login
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;

    try {
        const { data: userData, error: userError } = await supabase
            .from('users')
            .select('auth, nicknames, password, isVIP, vip_expires_at, vip_color, vipMessage, vipCelebration')
            .filter('nicknames', 'cs', JSON.stringify([username]));

        if (userError || !userData || userData.length === 0) {
            return res.status(400).json({ error: 'Invalid username or password' });
        }

        let user = userData.find(row => row.nicknames.includes(username));
        if (!user || user.password !== password) {
            return res.status(400).json({ error: 'Invalid username or password' });
        }

        const { data: statsData, error: statsError } = await supabase
            .from('player_stats')
            .select('wins, losses, draws, goals, assists, points, games_played, clean_sheets')
            .eq('auth', user.auth)
            .single();

        if (statsError || !statsData) {
            return res.status(400).json({ error: 'Error fetching player stats' });
        }

        // Update VIP status cache for this user
        cache.set(CACHE_KEY_VIP_STATUS, {
            ...cache.get(CACHE_KEY_VIP_STATUS),
            [user.auth]: {
                isVIP: user.isVIP && new Date(user.vip_expires_at) > new Date(),
                vip_color: user.vip_color,
                vipMessage: user.vipMessage,
                vipCelebration: user.vipCelebration
            }
        });

        res.json({
            auth: user.auth,
            userId: user.auth,
            username,
            stats: statsData,
            isVIP: user.isVIP,
            vip_expires_at: user.vip_expires_at,
            vip_color: user.vip_color,
            vipMessage: user.vipMessage,
            vipCelebration: user.vipCelebration
        });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ error: 'An error occurred during login' });
    }
});

// VIP message update
app.post('/api/updateVipMessage', async (req, res) => {
    const { auth, vipMessage } = req.body;

    try {
        const { error } = await supabase
            .from('users')
            .update({ vipMessage })
            .eq('auth', auth);

        if (error) {
            console.error('Error updating VIP message:', error);
            return res.status(500).json({ error: 'Failed to update VIP message' });
        }

        // Update cache
        const vipStatus = cache.get(CACHE_KEY_VIP_STATUS) || {};
        if (vipStatus[auth]) {
            vipStatus[auth].vipMessage = vipMessage;
            cache.set(CACHE_KEY_VIP_STATUS, vipStatus);
        }

        res.json({ success: true });
    } catch (err) {
        console.error('Server error updating VIP message:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// VIP celebration update
app.post('/api/updateVipCelebration', async (req, res) => {
    const { auth, vipCelebration } = req.body;

    try {
        const { error } = await supabase
            .from('users')
            .update({ vipCelebration })
            .eq('auth', auth);

        if (error) {
            console.error('Error updating VIP celebration:', error);
            return res.status(500).json({ error: 'Failed to update VIP celebration' });
        }

        // Update cache
        const vipStatus = cache.get(CACHE_KEY_VIP_STATUS) || {};
        if (vipStatus[auth]) {
            vipStatus[auth].vipCelebration = vipCelebration;
            cache.set(CACHE_KEY_VIP_STATUS, vipStatus);
        }

        res.json({ success: true });
    } catch (err) {
        console.error('Server error updating VIP celebration:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Verify auth token
app.post('/api/login/verify', async (req, res) => {
    const auth = req.headers.authorization?.replace('Bearer ', '');

    if (!auth) {
        return res.status(401).json({ error: 'No auth token provided' });
    }

    try {
        // Fetch user data
        const { data: userData, error: userError } = await supabase
            .from('users')
            .select('auth, nicknames, isVIP, vip_expires_at, vip_color, vipMessage, vipCelebration')
            .eq('auth', auth)
            .single();

        if (userError || !userData) {
            return res.status(401).json({ error: 'Invalid auth token' });
        }

        // Fetch player stats
        const { data: statsData, error: statsError } = await supabase
            .from('player_stats')
            .select('wins, losses, draws, goals, assists, points, games_played, clean_sheets')
            .eq('auth', auth)
            .single();

        if (statsError || !statsData) {
            return res.status(400).json({ error: 'Error fetching player stats' });
        }

        // Update VIP status cache
        cache.set(CACHE_KEY_VIP_STATUS, {
            ...cache.get(CACHE_KEY_VIP_STATUS),
            [auth]: {
                isVIP: userData.isVIP && new Date(userData.vip_expires_at) > new Date(),
                vip_color: userData.vip_color,
                vipMessage: userData.vipMessage,
                vipCelebration: userData.vipCelebration
            }
        });

        // Return user and stats data
        res.json({
            auth: userData.auth,
            userId: userData.auth,
            username: userData.nicknames[0], // Use first nickname
            stats: statsData,
            isVIP: userData.isVIP && new Date(userData.vip_expires_at) > new Date(),
            vip_expires_at: userData.vip_expires_at,
            vip_color: userData.vip_color,
            vipMessage: userData.vipMessage,
            vipCelebration: userData.vipCelebration
        });
    } catch (err) {
        console.error('Verify error:', err);
        res.status(500).json({ error: 'An error occurred during verification' });
    }
});

// Get player profile
app.get('/api/getPlayerProfile', async (req, res) => {
    const { auth } = req.query; // The auth ID of the profile being requested
    const userAuth = req.headers.authorization?.replace('Bearer ', '') || req.query.userAuth; // Get the logged-in user's auth from header or query

    try {
        // Check if the requested profile is the logged-in user's own profile
        const isOwnProfile = auth === userAuth;

        // If it's the user's own profile, fetch directly from Supabase
        if (isOwnProfile) {
            const { data: profileData, error } = await supabase
                .from('player_stats')
                .select('wins, losses, draws, goals, assists, points, games_played, clean_sheets')
                .eq('auth', auth)
                .single();

            if (error || !profileData) {
                return res.status(400).json({ error: 'Error fetching player profile' });
            }

            // Update cache with the fresh data
            const profiles = cache.get(CACHE_KEY_PLAYER_PROFILES) || {};
            cache.set(CACHE_KEY_PLAYER_PROFILES, { ...profiles, [auth]: profileData });

            return res.json({ profile: profileData });
        }

        // For other users' profiles, check the cache first
        const profiles = cache.get(CACHE_KEY_PLAYER_PROFILES) || {};
        if (profiles[auth]) {
            return res.json({ profile: profiles[auth] });
        }

        // Cache miss: fetch from Supabase for other users
        const { data: profileData, error } = await supabase
            .from('player_stats')
            .select('wins, losses, draws, goals, assists, points, games_played, clean_sheets')
            .eq('auth', auth)
            .single();

        if (error || !profileData) {
            return res.status(400).json({ error: 'Error fetching player profile' });
        }

        // Update cache
        cache.set(CACHE_KEY_PLAYER_PROFILES, { ...profiles, [auth]: profileData });

        res.json({ profile: profileData });
    } catch (err) {
        console.error('Error fetching player profile:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Handle BMC VIP purchase
app.post('/api/bmc-purchase', async (req, res) => {
    const { auth } = req.body;

    try {
        const now = new Date();
        const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

        const { error } = await supabase
            .from('users')
            .update({
                isVIP: true,
                vip_expires_at: expiresAt.toISOString(),
                vip_color: '#ffffff',
                vipMessage: '',
                vipCelebration: null
            })
            .eq('auth', auth);

        if (error) {
            console.error('Supabase BMC update error:', error);
            return res.status(500).json({ error: 'Failed to update VIP status' });
        }

        // Update cache
        const vipStatus = cache.get(CACHE_KEY_VIP_STATUS) || {};
        vipStatus[auth] = {
            isVIP: true,
            vip_color: '#ffffff',
            vipMessage: '',
            vipCelebration: null
        };
        cache.set(CACHE_KEY_VIP_STATUS, vipStatus);

        res.json({ success: true });
    } catch (err) {
        console.error('BMC purchase error:', err);
        res.status(500).json({ error: 'An error occurred while processing BMC purchase' });
    }
});

// Update VIP color
app.post('/api/update-vip-color', async (req, res) => {
    const { auth, color } = req.body;

    try {
        const { error } = await supabase
            .from('users')
            .update({ vip_color: color })
            .eq('auth', auth);

        if (error) {
            console.error('Error updating vip_color:', error);
            return res.status(500).json({ error: 'Failed to update VIP color' });
        }

        // Update cache
        const vipStatus = cache.get(CACHE_KEY_VIP_STATUS) || {};
        if (vipStatus[auth]) {
            vipStatus[auth].vip_color = color;
            cache.set(CACHE_KEY_VIP_STATUS, vipStatus);
        }

        res.json({ success: true });
    } catch (err) {
        console.error('Server error updating VIP color:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/api/room-link', async (req, res) => {
    try {
        const cachedRoomLink = cache.get(CACHE_KEY_ROOM_LINK);
        if (cachedRoomLink) {
            return res.json(cachedRoomLink);
        }

        const { data, error } = await supabase
            .from('room_link')
            .select('room_link, total_players, red_players, blue_players, spec_players, blue_score, red_score')
            .eq('id', 1)
            .single();

        if (error) {
            return res.status(400).json({ error: 'Could not fetch room link' });
        }

        cache.set(CACHE_KEY_ROOM_LINK, data);
        res.json(data);
    } catch (err) {
        console.error('Room link fetch error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/api/getRankings', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const cachedRankings = cache.get(CACHE_KEY_RANKINGS);

        if (cachedRankings && cachedRankings[page]) {

            // Fetch user stats if auth is provided
            let userStats = {};
            let userRank = null;
            if (req.query.auth) {
                const { data: userStat, error: userStatError } = await supabase
                    .from('player_stats')
                    .select('auth, rank, points, games_played, wins, draws, losses, goals, assists, clean_sheets')
                    .eq('auth', req.query.auth)
                    .single();

                if (userStatError) {
                    console.error('Error fetching user stats:', userStatError);
                } else {
                    userStats[req.query.auth] = userStat;
                    userRank = userStat.rank;
                }
            }

            return res.json({
                ...cachedRankings[page],
                userStats,
                countRank: userRank !== null ? userRank : 'Unranked'
            });
        }

        // Fallback to fetching data if cache is empty
        const perPage = 250;
        const offset = (page - 1) * perPage;

        const { data: statsData, error: statsError } = await supabase
            .from('player_stats')
            .select('auth, rank, points, games_played, wins, draws, losses, goals, assists, clean_sheets')
            .order('rank', { ascending: true })
            .range(offset, offset + perPage - 1);

        if (statsError) {
            console.error('Error fetching stats:', statsError);
            return res.status(500).json({ error: 'Failed to fetch rankings' });
        }

        const { count: totalCount, error: countError } = await supabase
            .from('player_stats')
            .select('auth', { count: 'exact', head: true });

        if (countError) {
            console.error('Error fetching total count:', countError);
            return res.status(500).json({ error: 'Failed to fetch total count' });
        }

        const authIds = statsData.map(stat => stat.auth);
        const { data: userDataRaw, error: userError } = await supabase
            .from('users')
            .select('auth, nicknames')
            .in('auth', authIds);

        if (userError) {
            console.error('Error fetching user data:', userError);
            return res.status(500).json({ error: 'Failed to fetch user data' });
        }

        const userData = userDataRaw.reduce((acc, curr) => {
            acc[curr.auth] = curr;
            return acc;
        }, {});

        let userStats = {};
        let userRank = null;
        if (req.query.auth) {
            const { data: userStat, error: userStatError } = await supabase
                .from('player_stats')
                .select('auth, rank, points, games_played, wins, draws, losses, goals, assists, clean_sheets')
                .eq('auth', req.query.auth)
                .single();

            if (userStatError) {
                console.error('Error fetching user stats:', userStatError);
            } else {
                userStats[req.query.auth] = userStat;
                userRank = userStat.rank;
            }
        }

        const responseData = {
            statsData,
            userData,
            userStats,
            countRank: userRank !== null ? userRank : 'Unranked',
            pagination: {
                currentPage: page,
                perPage,
                totalItems: totalCount,
                totalPages: Math.ceil(totalCount / perPage)
            }
        };

        // Update cache for this page
        const updatedRankings = cachedRankings || {};
        updatedRankings[page] = { statsData, userData, pagination: responseData.pagination };
        cache.set(CACHE_KEY_RANKINGS, updatedRankings);

        res.json(responseData);
    } catch (err) {
        console.error('Error in getRankings:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/vip-status', async (req, res) => {
    const { auth } = req.body;

    if (!auth) {
        return res.json({ auth: '', isVip: false, vipColor: null, vipMessage: null, vipCelebration: null });
    }

    try {
        const vipStatus = cache.get(CACHE_KEY_VIP_STATUS) || {};
        if (vipStatus[auth]) {
            return res.json(vipStatus[auth]);
        }

        const { data: userData, error } = await supabase
            .from('users')
            .select('isVIP, vip_color, vipMessage, vipCelebration, vip_expires_at')
            .eq('auth', auth)
            .single();

        if (error || !userData) {
            console.error('Error retrieving VIP status:', error);
            return res.status(500).json({ error: 'Failed to retrieve VIP status' });
        }

        const isVip = userData.isVIP && new Date(userData.vip_expires_at) > new Date();
        const vipData = {
            isVip,
            vipColor: userData.vip_color,
            vipMessage: userData.vipMessage,
            vipCelebration: userData.vipCelebration
        };

        // Update cache
        cache.set(CACHE_KEY_VIP_STATUS, { ...vipStatus, [auth]: vipData });

        res.json(vipData);
    } catch (err) {
        console.error('Error in vip-status:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    const os = require('os');
    const interfaces = os.networkInterfaces();

    console.log('Available on:');
    Object.values(interfaces).flat().forEach(i => {
        if (i.family === 'IPv4') {
            console.log(`http://${i.address}:${PORT}`);
        }
    });
});