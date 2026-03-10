const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('./db');

async function publishQueues(client, guildId) {
    const dbData = await db.get();
    const queues = dbData.queues || [];
    if (queues.length === 0) {
        return { count: 0 };
    }

    const queuesByChannel = {};
    for (const queue of queues) {
        if (!queuesByChannel[queue.channelId]) {
            queuesByChannel[queue.channelId] = [];
        }
        queuesByChannel[queue.channelId].push(queue);
    }

    let published = 0;

    for (const [channelId, channelQueues] of Object.entries(queuesByChannel)) {
        const channel = await client.channels.fetch(channelId).catch(() => null);
        if (!channel || (guildId && channel.guild.id !== guildId)) {
            continue;
        }

        channelQueues.sort((a, b) => Number(b.value) - Number(a.value));

        for (const queue of channelQueues) {
            if (queue.messageId) {
                try {
                    const oldMessage = await channel.messages.fetch(queue.messageId);
                    if (oldMessage) await oldMessage.delete();
                } catch {
                    // Ignore stale message ids.
                }
            }

            const embed = buildQueueEmbed(queue, dbData.embedSettings?.queue);

            const row = buildQueueButtons(queue);
            const sentMessage = await channel.send({ embeds: [embed], components: [row] });
            queue.messageId = sentMessage.id;
            published += 1;
        }
    }

    await db.set('queues', queues);
    return { count: published };
}

function buildQueueEmbed(queue, settings = {}, playersTextOverride = null) {
    const playersText = playersTextOverride || (queue.players.length > 0 ? queue.players.map((p) => `<@${p.id}>`).join('\n') : 'Nenhum jogador');
    const templateData = {
        mode: queue.mode.toUpperCase(),
        type: queue.type.toUpperCase(),
        value: String(queue.value),
        players: playersText,
        playerCount: String(queue.players.length)
    };

    const embed = new EmbedBuilder();
    embed.setColor(settings.color || '#1E90FF');
    embed.setTitle(applyTemplate(settings.title || '{mode} • {type}', templateData));
    embed.setDescription(applyTemplate(
        settings.description || 'TIPO: {type}\n\nPREÇO: R${value}\n\nJOGADORES\n{players}',
        templateData
    ));

    if (settings.thumbnail && isHttpUrl(settings.thumbnail)) {
        embed.setThumbnail(settings.thumbnail);
    } else {
        embed.setThumbnail('https://cdn.discordapp.com/attachments/1442275309721358498/1443310621306388642/4a5d08808a19c5eb00828b2a63cad70d.jpg');
    }

    if (settings.image && isHttpUrl(settings.image)) {
        embed.setImage(settings.image);
    }

    if (settings.footer) {
        embed.setFooter({ text: settings.footer });
    } else {
        embed.setFooter({ text: 'diamodff7x' });
    }

    return embed;
}

function applyTemplate(template, data) {
    return String(template || '')
        .replace(/\{\{(mode|type|value|players|playerCount)\}\}/g, (_, key) => data[key] ?? '')
        .replace(/\{(mode|type|value|players|playerCount)\}/g, (_, key) => data[key] ?? '');
}

function isHttpUrl(value) {
    return typeof value === 'string' && /^https?:\/\//i.test(value);
}

async function deleteQueueMessage(client, queue) {
    if (!queue || !queue.channelId || !queue.messageId) {
        return false;
    }

    const channel = await client.channels.fetch(queue.channelId).catch(() => null);
    if (!channel) {
        return false;
    }

    try {
        const message = await channel.messages.fetch(queue.messageId);
        if (message) {
            await message.delete();
            return true;
        }
    } catch {
        // Ignore missing/deleted messages.
    }

    return false;
}

async function deleteQueueById(client, queueId) {
    const queues = await db.get('queues') || [];
    const queue = queues.find((item) => item.id === queueId);

    if (!queue) {
        return { removed: 0, deletedMessages: 0 };
    }

    const deleted = await deleteQueueMessage(client, queue);
    const remainingQueues = queues.filter((item) => item.id !== queueId);
    await db.set('queues', remainingQueues);

    return { removed: 1, deletedMessages: deleted ? 1 : 0 };
}

async function deleteAllQueues(client) {
    const queues = await db.get('queues') || [];
    let deletedMessages = 0;

    for (const queue of queues) {
        const deleted = await deleteQueueMessage(client, queue);
        if (deleted) {
            deletedMessages += 1;
        }
    }

    await db.set('queues', []);
    return { removed: queues.length, deletedMessages };
}

function buildQueueButtons(queue) {
    const row = new ActionRowBuilder();

    if (queue.mode === 'mobile' || queue.mode === 'emulador') {
        if (queue.type === '1v1') {
            row.addComponents(
                new ButtonBuilder().setCustomId(`join_${queue.id}_geloinfinito`).setLabel('Gelo Infinito').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId(`join_${queue.id}_gelonormal`).setLabel('Gelo Normal').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId(`leave_${queue.id}`).setLabel('Sair').setStyle(ButtonStyle.Danger)
            );
        } else {
            row.addComponents(
                new ButtonBuilder().setCustomId(`join_${queue.id}_entrar`).setLabel('Entrar').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId(`join_${queue.id}_umpxm8`).setLabel('FULL UMP / XM8').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId(`leave_${queue.id}`).setLabel('Sair').setStyle(ButtonStyle.Danger)
            );
        }
    } else if (queue.mode === 'tatico') {
        row.addComponents(
            new ButtonBuilder().setCustomId(`join_${queue.id}_entrar`).setLabel('Entrar').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`leave_${queue.id}`).setLabel('Sair').setStyle(ButtonStyle.Danger)
        );
    } else if (queue.mode === 'misto') {
        if (queue.type === '2v2') {
            row.addComponents(
                new ButtonBuilder().setCustomId(`join_${queue.id}_1emu`).setLabel('1 Emu').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId(`leave_${queue.id}`).setLabel('Sair').setStyle(ButtonStyle.Danger)
            );
        } else if (queue.type === '3v3') {
            row.addComponents(
                new ButtonBuilder().setCustomId(`join_${queue.id}_1emu`).setLabel('1 Emu').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId(`join_${queue.id}_2emu`).setLabel('2 Emu').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId(`leave_${queue.id}`).setLabel('Sair').setStyle(ButtonStyle.Danger)
            );
        } else if (queue.type === '4v4') {
            row.addComponents(
                new ButtonBuilder().setCustomId(`join_${queue.id}_1emu`).setLabel('1 Emu').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId(`join_${queue.id}_2emu`).setLabel('2 Emu').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId(`join_${queue.id}_3emu`).setLabel('3 Emu').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId(`leave_${queue.id}`).setLabel('Sair').setStyle(ButtonStyle.Danger)
            );
        }
    }

    return row;
}

module.exports = { publishQueues, deleteQueueById, deleteAllQueues, buildQueueEmbed };
