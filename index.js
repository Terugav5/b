const { Client, GatewayIntentBits, Collection } = require('discord.js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();
const { startAdminPanel } = require('./web/server');

const client = new Client({
    intents: Object.values(GatewayIntentBits)
});

client.commands = new Collection();

// Load Commands
const foldersPath = path.join(__dirname, 'commands');
const commandFolders = fs.readdirSync(foldersPath);

for (const folder of commandFolders) {
    const commandsPath = path.join(foldersPath, folder);
    const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
    for (const file of commandFiles) {
        const filePath = path.join(commandsPath, file);
        const command = require(filePath);
        if ('data' in command && 'execute' in command) {
            client.commands.set(command.data.name, command);
        } else {
            console.log(`[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`);
        }
    }
}

// Load Events
const eventsPath = path.join(__dirname, 'events');
if (fs.existsSync(eventsPath)) {
    const eventFiles = fs.readdirSync(eventsPath).filter(file => file.endsWith('.js'));
    for (const file of eventFiles) {
        const filePath = path.join(eventsPath, file);
        const event = require(filePath);
        if (event.once) {
            client.once(event.name, (...args) => event.execute(...args));
        } else {
            client.on(event.name, (...args) => event.execute(...args));
        }
    }
}

// Error handling
client.on('error', error => {
    console.error('Discord client error:', error);
});

client.on('debug', info => {
    // Uncomment the line below for extremely verbose connection debugging
    // console.log('[DEBUG]', info);
});

client.on('shardError', (error, shardId) => {
    console.error(`[SHARD ${shardId}] Error:`, error);
});

process.on('unhandledRejection', error => {
    console.error('Unhandled promise rejection:', error);
});

// Login with token
const { token } = require('./config.json');
const botToken = process.env.DISCORD_TOKEN || token;

if (!botToken) {
    console.error('ERROR: No bot token found! Please set DISCORD_TOKEN in .env or token in config.json');
    process.exit(1);
}

console.log('Attempting to login to Discord...');
client.login(botToken)
    .then(() => {
        console.log('Login successful!');
        startAdminPanel(client);
    })
    .catch(error => {
        console.error('Failed to login to Discord:');
        if (error.code === 'TokenInvalid') {
            console.error('❌ Your bot token is INVALID. Please:');
            console.error('   1. Go to https://discord.com/developers/applications');
            console.error('   2. Select your application');
            console.error('   3. Go to the Bot section');
            console.error('   4. Reset your token and copy the new one');
            console.error('   5. Update config.json with the new token');
        } else if (error.code === 'ETIMEDOUT' || error.message.includes('timeout')) {
            console.error('❌ Connection TIMEOUT. Possible causes:');
            console.error('   1. Network/firewall blocking Discord');
            console.error('   2. Discord API is down');
            console.error('   3. Proxy/VPN interference');
        } else {
            console.error('❌ Error:', error.message);
        }
        process.exit(1);
    });
