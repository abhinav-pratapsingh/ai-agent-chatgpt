# AI Outreach Agent

AI Outreach Agent is a Node.js automation project that collects business leads from Google Maps, identifies businesses with missing or slow websites, generates personalized outreach emails, and sends emails safely within SMTP provider limits.

## Stack

- Node.js with ES modules
- MongoDB Atlas free tier
- Puppeteer for browsing and scraping
- Lighthouse for website performance analysis
- Nodemailer for SMTP sending
- node-cron for campaign scheduling
- Optional Ollama + llama3 for local email generation

## Project Structure

```text
/ai-outreach-agent
  /agents
    leadCollector.js
    emailExtractor.js
    speedAnalyzer.js
    leadScorer.js
    aiEmailWriter.js
    followupWriter.js
    subjectGenerator.js
    mailSender.js
  /config
    tierConfig.js
    smtpConfig.js
    countryConfig.js
    outreachModeConfig.js
  /database
    mongo.js
  /scheduler
    campaignScheduler.js
  /utils
    delay.js
    logger.js
  /public
    index.html
    emails.html
    app.js
    sent-emails.js
    styles.css
    config.js
  /deploy/nginx
    ai-outreach-agent.conf
  server.js
  ecosystem.config.cjs
  package.json
  .env.example
```

## MongoDB Schema

### leads collection

Each document stores:

- name
- website
- hasWebsite
- email
- industry
- city
- country
- timezone
- tier
- speedScore
- slowWebsite
- homepageLoadTimeMs
- score
- isTarget
- subjectLine
- emailBody
- followupBody
- contacted
- contactedDate
- followupSent
- nextFollowupAt
- createdAt
- updatedAt

### emailStats collection

Each document stores:

- provider
- emailsSentToday
- emailsSentThisHour
- lastDailyReset
- lastHourlyReset
- createdAt
- updatedAt

### appLogs collection

Each document stores:

- level
- message
- meta
- processName
- timestamp

## Install

```bash
npm install
```

## Run API Server

```bash
node server.js
```

## Manual Trigger API

Trigger the full campaign immediately:

```bash
curl -X POST http://127.0.0.1:6080/api/campaign/run -H "X-Admin-Key: YOUR_ADMIN_API_KEY"
```

Run a single-business workflow test without sending:

```bash
curl -X POST http://127.0.0.1:6080/api/workflow/test \
  -H "Content-Type: application/json" \
  -H "X-Admin-Key: YOUR_ADMIN_API_KEY" \
  -d '{"businessName":"Australian Dentists Clinic","countryName":"Australia","industry":"dentists"}'
```

Run a single-business workflow test and attempt sending:

```bash
curl -X POST http://127.0.0.1:6080/api/workflow/test \
  -H "Content-Type: application/json" \
  -H "X-Admin-Key: YOUR_ADMIN_API_KEY" \
  -d '{"businessName":"Australian Dentists Clinic","countryName":"Australia","industry":"dentists","send":true,"ignoreBusinessHours":true}'
```

Check runtime status:

```bash
curl http://127.0.0.1:6080/api/campaign/status
```

## Scheduler

```bash
node scheduler/campaignScheduler.js
```

The scheduler starts one cycle immediately, then checks every 15 minutes by default. Emails are only sent when the individual lead is inside their own local 9 AM to 6 PM business window.

## PM2 Setup

```bash
pm2 delete ai-outreach-api ai-outreach-agent
pm2 start ecosystem.config.cjs --update-env
pm2 save
pm2 startup
```

Useful commands:

```bash
pm2 list
pm2 logs ai-outreach-api --lines 100
pm2 logs ai-outreach-agent --lines 100
pm2 restart ecosystem.config.cjs --update-env
```

## Split Deployment: Frontend On Your PC, Backend On Server

### Server `.env`

Set these on the backend server:

```env
PORT=6080
FRONTEND_ORIGIN=http://localhost:4173
ADMIN_API_KEY=change-this-admin-key
```

If your PC frontend will run on another local port, update `FRONTEND_ORIGIN` to match exactly.

### Frontend On Your PC

Serve the `public` folder on your PC:

```bash
npx serve public -l 4173
```

Then open one of these in your browser:

```text
http://localhost:4173/?apiBase=http://YOUR_SERVER_PUBLIC_IP:6080&adminKey=YOUR_ADMIN_API_KEY
http://localhost:4173/emails?apiBase=http://YOUR_SERVER_PUBLIC_IP:6080&adminKey=YOUR_ADMIN_API_KEY
```

The frontend stores those values in browser local storage, so you only need to pass them once. After that you can just open:

```text
http://localhost:4173/
http://localhost:4173/emails
```

### Dashboard APIs Used By The Frontend

```bash
curl http://YOUR_SERVER_PUBLIC_IP:6080/api/dashboard -H "X-Admin-Key: YOUR_ADMIN_API_KEY"
curl http://YOUR_SERVER_PUBLIC_IP:6080/api/leads/recent -H "X-Admin-Key: YOUR_ADMIN_API_KEY"
curl http://YOUR_SERVER_PUBLIC_IP:6080/api/logs/recent -H "X-Admin-Key: YOUR_ADMIN_API_KEY"
curl http://YOUR_SERVER_PUBLIC_IP:6080/api/emails/sent -H "X-Admin-Key: YOUR_ADMIN_API_KEY"
```

## Dashboard Pages

Available frontend pages:

```text
/
/dashboard
/emails
```

Features included:

- KPI summary cards
- daily progress and lead breakdown panels
- active config and SMTP provider comparison
- recent leads pipeline table
- live persisted logs from the app
- sent email archive
- full email viewer with subject, body, follow-up body, recipient, website, score, and send timing

## Safe Test Send

Before real sending, set:

```env
TEST_MODE=true
TEST_RECIPIENT=your-email@example.com
```

Then restart PM2 and test one business with sending enabled:

```bash
pm2 restart ai-outreach-api ai-outreach-agent --update-env
curl -X POST http://127.0.0.1:6080/api/workflow/test \
  -H "Content-Type: application/json" \
  -H "X-Admin-Key: YOUR_ADMIN_API_KEY" \
  -d '{"businessName":"Australian Dentists Clinic","countryName":"Australia","industry":"dentists","send":true,"ignoreBusinessHours":true}'
```

## Nginx Setup

Example config:

```text
deploy/nginx/ai-outreach-agent.conf
```

Ubuntu install steps:

```bash
sudo apt update
sudo apt install -y nginx
sudo cp deploy/nginx/ai-outreach-agent.conf /etc/nginx/sites-available/ai-outreach-agent.conf
sudo ln -sf /etc/nginx/sites-available/ai-outreach-agent.conf /etc/nginx/sites-enabled/ai-outreach-agent.conf
sudo nginx -t
sudo systemctl restart nginx
```

## Gmail SMTP Setup

1. Turn on 2-Step Verification in the Gmail account.
2. Create an App Password inside Google Account security settings.
3. Put the Gmail address into `GMAIL_USER`.
4. Put the generated app password into `GMAIL_APP_PASSWORD`.
5. Set `SMTP_PROVIDER=gmail`.
6. Set `MAIL_FROM_EMAIL` to the same Gmail address or an approved alias.

## Ollama Setup

```bash
ollama pull llama3
ollama serve
```

Then set:

```env
OLLAMA_ENABLED=true
OLLAMA_MODEL=llama3
OLLAMA_BASE_URL=http://127.0.0.1:11434
```

## Important Notes

- Google Maps changes its markup often, so selectors in `agents/leadCollector.js` may need adjustment over time.
- Lighthouse and Puppeteer require extra system packages on some Linux servers.
- Run in `TEST_MODE=true` first with `TEST_RECIPIENT` set to your own email.
- Respect anti-spam laws and each provider's sending guidelines before contacting real businesses.
