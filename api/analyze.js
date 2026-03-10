export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { username } = req.body;
    if (!username) return res.status(400).json({ error: 'No username provided' });

    // 1. Get user info
    const userRes = await fetch(
      `https://api.twitter.com/2/users/by/username/${username}?user.fields=public_metrics,description,name`,
      { headers: { Authorization: `Bearer ${process.env.X_BEARER_TOKEN}` } }
    );
    const userData = await userRes.json();

    if (userData.errors || !userData.data) {
      return res.status(404).json({ error: 'الحساب مو موجود أو خاص' });
    }

    const user = userData.data;
    const userId = user.id;
    const metrics = user.public_metrics || {};

    // 2. Get recent tweets
    const tweetsRes = await fetch(
      `https://api.twitter.com/2/users/${userId}/tweets?max_results=10&tweet.fields=public_metrics,created_at&exclude=retweets`,
      { headers: { Authorization: `Bearer ${process.env.X_BEARER_TOKEN}` } }
    );
    const tweetsData = await tweetsRes.json();
    const tweets = tweetsData.data || [];
    const tweetTexts = tweets.map((t, i) => `${i + 1}. ${t.text}`).join('\n');

    // 3. Build prompt
    const context = `
معلومات الحساب:
- الاسم: ${user.name}
- username: @${username}
- البايو: ${user.description || 'لا يوجد'}
- المتابعون: ${metrics.followers_count?.toLocaleString() || 0}
- يتابع: ${metrics.following_count?.toLocaleString() || 0}
- إجمالي التغريدات: ${metrics.tweet_count?.toLocaleString() || 0}

آخر التغريدات:
${tweetTexts || 'لا توجد تغريدات متاحة'}`.trim();

    const prompt = `أنت محلل نفسي متخصص في تحليل شخصيات مستخدمي X. حلل هذا الحساب بدقة وصراحة بناءً على بياناته الحقيقية.

${context}

أعطني JSON فقط بهذا الهيكل (بدون أي نص خارج الـ JSON):
{
  "personality_type": "وصف نوع الشخصية في 4-5 كلمات",
  "avatar_letter": "أول حرف من اسمه",
  "summary": "تحليل شخصيته في 3 جمل دقيقة وصريحة بناءً على تغريداته الحقيقية",
  "scores": {"التأثير": 80, "المصداقية": 65, "الانتظام": 75},
  "strengths": "نقاط قوته الحقيقية في جملتين",
  "weakness": "نقاط ضعفه بصراحة في جملتين",
  "audience": "من يتابعه ولماذا في جملتين",
  "content_style": "أسلوبه في المحتوى في جملتين بناءً على تغريداته",
  "keywords": ["وسم1","وسم2","وسم3","وسم4","وسم5"],
  "verdict_emoji": "إيموجي يمثله",
  "verdict_title": "حكم نهائي في 4 كلمات",
  "verdict_text": "تقييم ختامي جريء وصادق في جملتين"
}`;

    // 4. Analyze with Claude
    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const claudeData = await claudeRes.json();
    const raw = claudeData.content?.[0]?.text || '';
    const analysis = JSON.parse(raw.replace(/```json|```/g, '').trim());

    return res.status(200).json({
      analysis,
      profile: {
        name: user.name,
        username,
        followers: metrics.followers_count || 0,
        following: metrics.following_count || 0,
        tweets_count: metrics.tweet_count || 0,
        bio: user.description || ''
      }
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'حدث خطأ، حاول مجدداً' });
  }
}
