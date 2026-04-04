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
  server.js
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

## Install

```bash
npm install
```

## Run Local Health Server

```bash
node server.js
```

## Manual Trigger API

Start the local API server:

```bash
node server.js
```

Trigger the full campaign immediately from the same server:

```bash
curl -X POST http://127.0.0.1:6080/api/campaign/run
```

Run a single-business workflow test without sending:

```bash
curl -X POST http://127.0.0.1:6080/api/workflow/test \
  -H "Content-Type: application/json" \
  -d "{\"businessName\":\"Australian Dentists Clinic\",\"countryName\":\"Australia\",\"industry\":\"dentists\"}"
```

Run a single-business workflow test and attempt sending:

```bash
curl -X POST http://127.0.0.1:6080/api/workflow/test \
  -H "Content-Type: application/json" \
  -d "{\"businessName\":\"Australian Dentists Clinic\",\"countryName\":\"Australia\",\"industry\":\"dentists\",\"send\":true}"
```

Check whether the API is up and whether a campaign is currently running:

```bash
curl http://127.0.0.1:6080/api/campaign/status
```

See the most recent sent emails:

```bash
curl http://127.0.0.1:6080/api/emails/sent
```

This manual trigger runs the full flow:

- collect leads
- extract emails
- analyze website speed
- score leads
- send outreach emails
- send follow-up emails

The endpoint is localhost-only, so it will only accept requests from the same machine.

## Run Scheduler

```bash
node scheduler/campaignScheduler.js
```

The scheduler starts one cycle immediately, then checks every 15 minutes by default. Emails are only sent when the individual lead is inside their own local 9 AM to 6 PM business window.

To change the polling cadence, set:

```env
CAMPAIGN_POLL_CRON=*/15 * * * *
STATS_RESET_CRON=0 * * * *
```

## PM2 Setup

```bash
npm install
pm2 delete ai-outreach-api ai-outreach-agent
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

This ecosystem file starts:

- `ai-outreach-api` on port `6080`
- `ai-outreach-agent` for the scheduler

Useful PM2 commands:

```bash
pm2 list
pm2 logs ai-outreach-api --lines 100
pm2 logs ai-outreach-agent --lines 100
pm2 restart ecosystem.config.cjs
```

Manual trigger with PM2:

```bash
curl -X POST http://127.0.0.1:6080/api/campaign/run
curl -X POST http://127.0.0.1:6080/api/workflow/test -H "Content-Type: application/json" -d "{\"businessName\":\"Australian Dentists Clinic\",\"countryName\":\"Australia\",\"industry\":\"dentists\"}"
curl http://127.0.0.1:6080/api/campaign/status
curl http://127.0.0.1:6080/api/emails/sent
```

## Amazon EC2 Ubuntu Setup

```bash
sudo apt update
sudo apt install -y curl git
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g pm2
git clone <your-repo-url> ai-outreach-agent
cd ai-outreach-agent
npm install
cp .env.example .env
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

## Gmail SMTP Setup

1. Turn on 2-Step Verification in the Gmail account.
2. Create an App Password inside Google Account security settings.
3. Put the Gmail address into GMAIL_USER.
4. Put the generated app password into GMAIL_APP_PASSWORD.
5. Set SMTP_PROVIDER=gmail.
6. Set MAIL_FROM_EMAIL to the same Gmail address or an approved alias.

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

- Google Maps changes its markup often, so selectors in agents/leadCollector.js may need adjustment over time.
- Lighthouse and Puppeteer require extra system packages on some Linux servers.
- Run in TEST_MODE=true first with TEST_RECIPIENT set to your own email.
- Respect anti-spam laws and each provider's sending guidelines before contacting real businesses.
