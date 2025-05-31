const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
const cors = require('cors');
const path = require('path');

// Load environment variables
dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Serve static files (including HTML)
app.use(express.static(path.join(__dirname, 'public')));

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

app.get('/', (req, res) => {
    // Serve the index.html from the 'public' folder
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

        res.json({ success: true });
    } catch (err) {
        console.error('Server error updating VIP celebration:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Get player profile
app.get('/api/getPlayerProfile', async (req, res) => {
    const { auth } = req.query;

    try {
        const { data: profileData, error } = await supabase
            .from('player_stats')
            .select('wins, losses, draws, goals, assists, points, games_played, clean_sheets')
            .eq('auth', auth)
            .single();

        if (error || !profileData) {
            return res.status(400).json({ error: 'Error fetching player profile' });
        }

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

        res.json({ success: true });
    } catch (err) {
        console.error('Server error updating VIP color:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/api/room-link', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('room_link')
            .select('room_link, total_players, red_players, blue_players, spec_players, blue_score, red_score')
            .eq('id', 1)
            .single();

        if (error) {
            return res.status(400).json({ error: 'Could not fetch room link' });
        }
        res.json(data);
    } catch (err) {
        console.error('Room link fetch error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/api/getRankings', async (req, res) => {
    try {
        // Get page number from query params (default to 1 if not provided)
        const page = parseInt(req.query.page) || 1;
        const perPage = 250;
        const offset = (page - 1) * perPage;

        // Fetch paginated player stats including the rank column
        const { data: statsData, error: statsError } = await supabase
            .from('player_stats')
            .select('auth, rank, points, games_played, wins, draws, losses, goals, assists, clean_sheets')
            .order('rank', { ascending: true }) // Order by rank instead of points
            .range(offset, offset + perPage - 1);

        if (statsError) {
            console.error('Error fetching stats:', statsError);
            return res.status(500).json({ error: 'Failed to fetch rankings' });
        }

        // Get total count for pagination
        const { count: totalCount, error: countError } = await supabase
            .from('player_stats')
            .select('auth', { count: 'exact', head: true });

        if (countError) {
            console.error('Error fetching total count:', countError);
            return res.status(500).json({ error: 'Failed to fetch total count' });
        }

        // Fetch user data for all auth IDs
        const authIds = statsData.map(stat => stat.auth);
        const { data: userDataRaw, error: userError } = await supabase
            .from('users')
            .select('auth, nicknames')
            .in('auth', authIds);

        if (userError) {
            console.error('Error fetching user data:', userError);
            return res.status(500).json({ error: 'Failed to fetch user data' });
        }

        // Map user data by auth ID
        const userData = userDataRaw.reduce((acc, user) => {
            acc[user.auth] = user;
            return acc;
        }, {});

        // Fetch current user's stats if logged in
        let userStats = {};
        let userRank = null; // Will store the rank from the database
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
                userRank = userStat.rank; // Use the rank from the database
            }
        }

        res.json({
            statsData,
            userData,
            userStats,
            countRank: userRank !== null ? userRank : 'Unranked', // Use DB rank or 'Unranked'
            pagination: {
                currentPage: page,
                perPage,
                totalItems: totalCount,
                totalPages: Math.ceil(totalCount / perPage)
            }
        });
    } catch (err) {
        console.error('Error in getRankings:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/vip-status', async (req, res) => {
    const { auth } = req.body;

    if (!auth) {
        return res.json({ isVip: false, vipColor: null, vipMessage: null, vipCelebration: null });
    }

    try {
        const { data: userData, error } = await supabase
            .from('users')
            .select('isVIP, vip_color, vipMessage, vipCelebration, vip_expires_at')
            .eq('auth', auth)
            .single();

        if (error || !userData) {
            console.error('Error fetching VIP status:', error);
            return res.status(500).json({ error: 'Failed to fetch VIP status' });
        }

        const isVip = userData.isVIP && new Date(userData.vip_expires_at) > new Date();
        res.json({
            isVip,
            vipColor: userData.vip_color,
            vipMessage: userData.vipMessage,
            vipCelebration: userData.vipCelebration
        });
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
      console.log(`http://${i.address}:3000`);
    }
  });
});
