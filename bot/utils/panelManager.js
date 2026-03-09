const { EmbedBuilder } = require('discord.js');
const db = require('./db');

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

        let panelMessage;

        if (config.mediatorMessageId) {
            try {
                panelMessage = await channel.messages.fetch(config.mediatorMessageId);
            } catch (e) {
                console.log('Mensagem do painel salva não encontrada, procurando...');
            }
        }

        if (!panelMessage) {
            const messages = await channel.messages.fetch({ limit: 50 });
            panelMessage = messages.find(m =>
                m.author.id === client.user.id &&
                m.embeds.length > 0 &&
                m.embeds[0].title === 'Painel de Mediadores'
            );
        }

        if (!panelMessage) {
            console.log(`Não foi possível encontrar a mensagem do painel de mediadores no canal ${channel.name}.`);
            return;
        }

        const onlineMediators = Object.entries(dbData.mediators || {})
            .filter(([_, data]) => data.online)
            .map(([id, _]) => `<@${id}>`)
            .join('\n');

        const embedSettings = dbData.embedSettings?.mediator || {};

        const embed = new EmbedBuilder()
            .setTitle('Painel de Mediadores')
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

module.exports = { updateMediatorPanel };
