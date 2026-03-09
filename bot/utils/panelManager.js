const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('./db');

async function ensureMediatorPanelMessage(client, guild) {
    const dbData = await db.get();
    const config = dbData.config || {};
    if (!config.mediatorChannel) {
        throw new Error('Canal de mediadores não configurado.');
    }

    const channel = await guild.channels.fetch(config.mediatorChannel);
    if (!channel) {
        throw new Error('Canal de mediadores não encontrado.');
    }

    let panelMessage = null;

    if (config.mediatorMessageId) {
        panelMessage = await channel.messages.fetch(config.mediatorMessageId).catch(() => null);
    }

    if (!panelMessage) {
        const messages = await channel.messages.fetch({ limit: 50 });
        panelMessage = messages.find((message) =>
            message.author.id === client.user.id &&
            message.embeds.length > 0 &&
            message.embeds[0].title === 'Painel de Mediadores'
        ) || null;
    }

    if (!panelMessage) {
        const embedSettings = dbData.embedSettings?.mediator || {};
        const embed = new EmbedBuilder()
            .setTitle(embedSettings.title || 'Painel de Mediadores')
            .setDescription('Não há mediadores online no momento.')
            .setColor(embedSettings.color || 'Blue')
            .setTimestamp();

        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder().setCustomId('mediator_join').setLabel('Entrar').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId('mediator_leave').setLabel('Sair').setStyle(ButtonStyle.Danger)
            );

        panelMessage = await channel.send({ embeds: [embed], components: [row] });
    }

    config.mediatorMessageId = panelMessage.id;
    await db.set('config', config);

    return panelMessage;
}

async function updateMediatorPanel(client, guild) {
    const dbData = await db.get();
    const config = dbData.config;
    if (!config || !config.mediatorChannel) {
        console.log('Canal de mediadores não configurado, pulando atualização do painel.');
        return;
    }

    try {
        const channel = await guild.channels.fetch(config.mediatorChannel);
        if (!channel) {
            console.log(`Canal de mediadores (${config.mediatorChannel}) não encontrado.`);
            return;
        };

        const panelMessage = await ensureMediatorPanelMessage(client, guild);

        const onlineMediators = Object.entries(dbData.mediators || {})
            .filter(([_, data]) => data.online)
            .map(([id, _]) => `<@${id}>`)
            .join('\n');

        const embedSettings = dbData.embedSettings?.mediator || {};

        const embed = new EmbedBuilder()
            .setTitle(embedSettings.title || 'Painel de Mediadores')
            .setDescription(onlineMediators || 'Não há mediadores online no momento.')
            .setColor(embedSettings.color || 'Blue')
            .setTimestamp();

        if (embedSettings.footer) embed.setFooter({ text: embedSettings.footer });
        if (embedSettings.image && embedSettings.image.startsWith('http')) {
            embed.setImage(embedSettings.image);
        }

        await panelMessage.edit({ embeds: [embed] });

    } catch (error) {
        console.error('Falha ao atualizar o painel de mediadores:', error);
    }
}

module.exports = { ensureMediatorPanelMessage, updateMediatorPanel };
