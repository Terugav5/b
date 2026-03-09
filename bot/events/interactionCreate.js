const { Events, EmbedBuilder } = require('discord.js');
const db = require('../utils/db');
const { updateMediatorPanel } = require('../utils/panelManager');
const path = require('path');
const fs = require('fs');

module.exports = {
    name: Events.InteractionCreate,
    async execute(interaction) {
        if (interaction.isChatInputCommand()) {
            const command = interaction.client.commands.get(interaction.commandName);

            if (!command) {
                console.error(`No command matching ${interaction.commandName} was found.`);
                return;
            }

            try {
                await command.execute(interaction);
            } catch (error) {
                console.error(error);
                if (interaction.replied || interaction.deferred) {
                    await interaction.followUp({ content: 'There was an error while executing this command!', ephemeral: true });
                } else {
                    await interaction.reply({ content: 'There was an error while executing this command!', ephemeral: true });
                }
            }
        } else if (interaction.isButton()) {
            await handleButtons(interaction);
        } else if (interaction.isStringSelectMenu() || interaction.isChannelSelectMenu() || interaction.isUserSelectMenu() || interaction.isRoleSelectMenu()) {
            await handleSelectMenus(interaction);
        } else if (interaction.isModalSubmit()) {
            // Handle modals if needed
        }
    },
};

// Temporary storage for setup wizard (in memory)
const setupCache = new Map();

async function handleSelectMenus(interaction) {
    const { customId, values } = interaction;

    if (customId === 'queue_setup_mode') {
        const mode = values[0];
        setupCache.set(interaction.user.id, { mode });

        const { ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');

        let options = [];
        if (mode === 'mobile' || mode === 'emulador' || mode === 'tatico') {
            options = [
                { label: '1v1', value: '1v1' },
                { label: '2v2', value: '2v2' },
                { label: '3v3', value: '3v3' },
                { label: '4v4', value: '4v4' }
            ];
        } else if (mode === 'misto') {
            options = [
                { label: '2v2', value: '2v2' },
                { label: '3v3', value: '3v3' },
                { label: '4v4', value: '4v4' }
            ];
        }

        const row = new ActionRowBuilder()
            .addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId('queue_setup_type')
                    .setPlaceholder('Selecione o tipo de partida')
                    .addOptions(options)
            );

        await interaction.update({ content: `Modalidade: **${mode}**. Agora selecione o tipo:`, components: [row] });

    } else if (customId === 'queue_setup_type') {
        const type = values[0];
        const data = setupCache.get(interaction.user.id) || {};
        data.type = type;
        setupCache.set(interaction.user.id, data);

        const { ActionRowBuilder, ChannelSelectMenuBuilder, ChannelType } = require('discord.js');

        const row = new ActionRowBuilder()
            .addComponents(
                new ChannelSelectMenuBuilder()
                    .setCustomId('queue_setup_channel')
                    .setPlaceholder('Selecione o canal das filas')
                    .setChannelTypes(ChannelType.GuildText)
            );

        await interaction.update({ content: `Tipo: **${type}**. Agora selecione o canal onde a fila será enviada:`, components: [row] });

    } else if (customId === 'queue_setup_channel') {
        const channelId = values[0];
        const data = setupCache.get(interaction.user.id) || {};
        data.channelId = channelId;
        setupCache.set(interaction.user.id, data);

        const { ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');

        const row = new ActionRowBuilder()
            .addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId('queue_setup_values')
                    .setPlaceholder('Selecione os valores (pode selecionar vários)')
                    .setMinValues(1)
                    .setMaxValues(10)
                    .addOptions(
                        { label: '1', value: '1' },
                        { label: '2', value: '2' },
                        { label: '3', value: '3' },
                        { label: '5', value: '5' },
                        { label: '10', value: '10' },
                        { label: '20', value: '20' },
                        { label: '30', value: '30' },
                        { label: '40', value: '40' },
                        { label: '50', value: '50' },
                        { label: '100', value: '100' }
                    )
            );

        await interaction.update({ content: `Canal selecionado. Agora selecione os valores:`, components: [row] });

    } else if (customId === 'queue_setup_values') {
        const selectedValues = values;
        const data = setupCache.get(interaction.user.id) || {};
        data.values = selectedValues;

        const queues = await db.get('queues') || [];

        for (const val of selectedValues) {
            queues.push({
                id: `${data.mode}-${data.type}-${val}-${Date.now()}`,
                mode: data.mode,
                type: data.type,
                value: val,
                channelId: data.channelId,
                players: []
            });
        }

        await db.set('queues', queues);
        setupCache.delete(interaction.user.id);

        await interaction.update({ content: `Configuração concluída! ${selectedValues.length} filas criadas para **${data.mode} ${data.type}** no canal <#${data.channelId}> com valores: ${selectedValues.join(', ')}. Use /filas para enviar.`, components: [] });
    }
}

async function handleButtons(interaction) {
    const { customId, user, guild } = interaction;
    const dbData = await db.get();

    if (customId === 'mediator_join') {
        await interaction.deferReply({ ephemeral: true });
        const config = dbData.config;
        if (!config.mediatorRole) return interaction.editReply({ content: 'Cargo de mediador não configurado.' });

        const member = await guild.members.fetch(user.id);
        if (!member.roles.cache.has(config.mediatorRole)) {
            return interaction.editReply({ content: 'Você não tem permissão para ser mediador.' });
        }

        if (!dbData.mediators[user.id] || !dbData.mediators[user.id].pix) {
            return interaction.editReply({ content: 'Você precisa cadastrar seu Pix primeiro com /pix.' });
        }

        dbData.mediators[user.id].online = true;
        dbData.mediators[user.id].name = user.username;
        await db.set('mediators', dbData.mediators);

        await updateMediatorPanel(interaction.client, interaction.guild);
        await interaction.editReply({ content: 'Você entrou no painel de mediadores.' });

    } else if (customId === 'mediator_leave') {
        await interaction.deferReply({ ephemeral: true });
        if (!dbData.mediators[user.id] || !dbData.mediators[user.id].online) {
            return interaction.editReply({ content: 'Você não está online no painel de mediadores.' });
        }

        dbData.mediators[user.id].online = false;
        await db.set('mediators', dbData.mediators);

        await updateMediatorPanel(interaction.client, interaction.guild);
        await interaction.editReply({ content: 'Você saiu do painel de mediadores.' });

    } else if (customId.startsWith('join_')) {
        await interaction.deferReply({ ephemeral: true });
        await handleQueueJoin(interaction, dbData);
    } else if (customId.startsWith('leave_')) {
        await interaction.deferReply({ ephemeral: true });
        await handleQueueLeave(interaction, dbData);
    } else if (customId.startsWith('match_confirm_')) {
        await handleMatchConfirm(interaction, dbData);
    } else if (customId.startsWith('match_close_')) {
        await handleMatchClose(interaction, dbData);
    } else if (customId.startsWith('copy_pix_key_')) {
        const mediatorId = customId.split('_')[3];
        const mediators = await db.get('mediators') || {};
        const mediatorData = mediators[mediatorId];

        if (mediatorData && mediatorData.pix) {
            await interaction.reply({ content: mediatorData.pix, ephemeral: true });
        } else {
            await interaction.reply({ content: 'Não foi possível encontrar a chave Pix deste mediador.', ephemeral: true });
        }
    }
}

async function handleQueueJoin(interaction, dbData) {
    const { customId, user, guild } = interaction;
    const parts = customId.split('_');
    const queueId = parts[1];

    const onlineMediators = Object.values(dbData.mediators).filter(m => m.online);
    if (onlineMediators.length === 0) {
        return interaction.editReply({ content: 'Não há mediadores online no momento. A fila está fechada.' });
    }

    const queue = dbData.queues.find(q => q.id === queueId);
    if (!queue) return interaction.editReply({ content: 'Fila não encontrada.' });

    if (queue.players.some(p => p.id === user.id)) {
        return interaction.editReply({ content: 'Você já está nesta fila.' });
    }

    const playerType = parts[2] || 'default';
    queue.players.push({ id: user.id, name: user.username, type: playerType });
    await db.set('queues', dbData.queues);

    let replyMessage = 'Você entrou na fila!';
    let typeLabel = '';

    if (queue.mode === 'misto') {
        if (queue.type === '2v2') {
            typeLabel = '1 Emu';
        } else if (queue.type === '3v3') {
            if (playerType === '1emu') typeLabel = '1 Emu';
            else if (playerType === '2emu') typeLabel = '2 Emu';
        } else if (queue.type === '4v4') {
            if (playerType === '1emu') typeLabel = '1 Emu';
            else if (playerType === '2emu') typeLabel = '2 Emu';
            else if (playerType === '3emu') typeLabel = '3 Emu';
        }
    } else if (queue.type === '1v1' && (queue.mode === 'mobile' || queue.mode === 'emulador')) {
        if (playerType === 'geloinfinito') typeLabel = 'Gelo Infinito';
        else if (playerType === 'gelonormal') typeLabel = 'Gelo Normal';
    }

    if (typeLabel) {
        replyMessage = `Você entrou na fila como ${typeLabel}!`;
    }

    await interaction.editReply({ content: replyMessage });

    await updateQueueEmbed(interaction, queue);
    await checkMatch(interaction, queue, dbData);
}

async function handleQueueLeave(interaction, dbData) {
    const { customId, user } = interaction;
    const queueId = customId.split('_')[1];

    const queue = dbData.queues.find(q => q.id === queueId);
    if (!queue) return interaction.editReply({ content: 'Fila não encontrada.' });

    const index = queue.players.findIndex(p => p.id === user.id);
    if (index === -1) return interaction.editReply({ content: 'Você não está nesta fila.' });

    queue.players.splice(index, 1);
    await db.set('queues', dbData.queues);

    await interaction.editReply({ content: 'Você saiu da fila.' });
    await updateQueueEmbed(interaction, queue);
}

async function updateQueueEmbed(interaction, queue) {
    const channel = await interaction.guild.channels.fetch(queue.channelId);
    if (!channel) return;

    let message;
    if (queue.messageId) {
        try {
            message = await channel.messages.fetch(queue.messageId);
        } catch (e) {
            console.log("Message not found by ID");
        }
    }

    if (!message) return;

    const embed = EmbedBuilder.from(message.embeds[0]);

    // Format players with their type
    let playersText = 'Nenhum jogador';
    if (queue.players.length > 0) {
        // Mobile/Emulador 1v1: show ice type
        if (queue.type === '1v1' && (queue.mode === 'mobile' || queue.mode === 'emulador')) {
            playersText = queue.players.map(p => {
                const typeLabel = p.type === 'geloinfinito' ? 'Gelo Infinito' : 'Gelo Normal';
                return `<@${p.id}> | ${typeLabel}`;
            }).join('\n');
        }
        // Misto 2v2: show emu count
        else if (queue.mode === 'misto' && queue.type === '2v2') {
            playersText = queue.players.map(p => {
                return `${p.name} | 1 Emu`;
            }).join('\n');
        }
        // Misto 3v3: show emu count
        else if (queue.mode === 'misto' && queue.type === '3v3') {
            playersText = queue.players.map(p => {
                const typeLabel = p.type === '1emu' ? '1 Emu' : '2 Emu';
                return `${p.name} | ${typeLabel}`;
            }).join('\n');
        }
        // Misto 4v4: show emu count
        else if (queue.mode === 'misto' && queue.type === '4v4') {
            playersText = queue.players.map(p => {
                let typeLabel = '';
                if (p.type === '1emu') typeLabel = '1 Emu';
                else if (p.type === '2emu') typeLabel = '2 Emu';
                else if (p.type === '3emu') typeLabel = '3 Emu';
                return `${p.name} | ${typeLabel}`;
            }).join('\n');
        }
        // Other modes: just show player mentions
        else {
            playersText = queue.players.map(p => `<@${p.id}>`).join('\n');
        }
    }

    embed.setDescription(`${queue.mode.toUpperCase()}\n\nTIPO: ${queue.type.toUpperCase()}\n\nPREÇO: R$${queue.value}\n\nJOGADORES\n${playersText}`);
    embed.setColor('#1E90FF');
    embed.setThumbnail('https://cdn.discordapp.com/attachments/1442275309721358498/1443310621306388642/4a5d08808a19c5eb00828b2a63cad70d.jpg');

    await message.edit({ embeds: [embed] });
}

async function checkMatch(interaction, queue, dbData) {
    let required = 0;
    if (queue.type === '1v1') required = 2;
    else if (queue.type === '2v2') required = 4;
    else if (queue.type === '3v3') required = 6;
    else if (queue.type === '4v4') required = 8;

    if (queue.players.length >= required) {
        let players = [];

        // Mobile/Emulador 1v1: match players with same ice type
        if (queue.type === '1v1' && (queue.mode === 'mobile' || queue.mode === 'emulador')) {
            const geloinfinito = queue.players.filter(p => p.type === 'geloinfinito');
            const gelonormal = queue.players.filter(p => p.type === 'gelonormal');

            if (geloinfinito.length >= 2) {
                players = geloinfinito.splice(0, 2);
                queue.players = queue.players.filter(p => !players.some(pl => pl.id === p.id));
            } else if (gelonormal.length >= 2) {
                players = gelonormal.splice(0, 2);
                queue.players = queue.players.filter(p => !players.some(pl => pl.id === p.id));
            } else {
                return; // Not enough players with same ice type
            }
        }
        // Misto 2v2: all players are 1 emu
        else if (queue.mode === 'misto' && queue.type === '2v2') {
            players = queue.players.splice(0, 4);
        }
        // Misto 3v3: match players with same emu count
        else if (queue.mode === 'misto' && queue.type === '3v3') {
            const emu1 = queue.players.filter(p => p.type === '1emu');
            const emu2 = queue.players.filter(p => p.type === '2emu');

            if (emu1.length >= 6) {
                players = emu1.splice(0, 6);
                queue.players = queue.players.filter(p => !players.some(pl => pl.id === p.id));
            } else if (emu2.length >= 6) {
                players = emu2.splice(0, 6);
                queue.players = queue.players.filter(p => !players.some(pl => pl.id === p.id));
            } else {
                return; // Not enough players with same emu count
            }
        }
        // Misto 4v4: match players with same emu count, no mixing 2emu and 3emu
        else if (queue.mode === 'misto' && queue.type === '4v4') {
            const emu1 = queue.players.filter(p => p.type === '1emu');
            const emu2 = queue.players.filter(p => p.type === '2emu');
            const emu3 = queue.players.filter(p => p.type === '3emu');

            if (emu1.length >= 8) {
                players = emu1.splice(0, 8);
                queue.players = queue.players.filter(p => !players.some(pl => pl.id === p.id));
            } else if (emu2.length >= 8) {
                players = emu2.splice(0, 8);
                queue.players = queue.players.filter(p => !players.some(pl => pl.id === p.id));
            } else if (emu3.length >= 8) {
                players = emu3.splice(0, 8);
                queue.players = queue.players.filter(p => !players.some(pl => pl.id === p.id));
            } else {
                return; // Not enough players of the same type
            }
        }
        // Other modes: just take required number of players
        else {
            players = queue.players.splice(0, required);
        }

        await db.set('queues', dbData.queues);
        await updateQueueEmbed(interaction, queue);

        const onlineMediators = Object.entries(dbData.mediators).filter(([_, data]) => data.online);
        const mediatorId = onlineMediators[Math.floor(Math.random() * onlineMediators.length)][0];

        const { ChannelType, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } = require('discord.js');
        const guild = interaction.guild;
        const path = require('path');

        const channelName = `match-${queue.type}-${Date.now().toString().slice(-4)}`;

        const permissionOverwrites = [
            { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
            { id: mediatorId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
            { id: interaction.client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }
        ];

        for (const p of players) {
            permissionOverwrites.push({ id: p.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] });
        }

        const channel = await guild.channels.create({
            name: channelName,
            type: ChannelType.GuildText,
            permissionOverwrites: permissionOverwrites
        });

        const gifPath = path.join(__dirname, '..', 'test.gif');
        const attachment = new AttachmentBuilder(gifPath, { name: 'test.gif' });

        const embedSettings = dbData.embedSettings?.match || {};

        const embed = new EmbedBuilder()
            .setTitle('Partida Encontrada!')
            .setDescription(`Mediador: <@${mediatorId}>\nJogadores:\n${players.map(p => `<@${p.id}>`).join('\n')}`)
            .setColor(embedSettings.color || '#1E90FF');

        if (embedSettings.image) {
            embed.setImage(embedSettings.image);
        } else {
            embed.setImage('attachment://test.gif');
        }

        if (embedSettings.footer) {
            embed.setFooter({ text: embedSettings.footer });
        }

        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder().setCustomId(`match_confirm_${mediatorId}`).setLabel('Confirmar').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId('match_close_channel').setLabel('Encerrar').setStyle(ButtonStyle.Danger)
            );

        await channel.send({ content: `${players.map(p => `<@${p.id}>`).join(' ')} <@${mediatorId}>`, embeds: [embed], components: [row], files: [attachment] });

        const activeMatches = await db.get('activeMatches') || [];
        activeMatches.push({
            channelId: channel.id,
            mediatorId: mediatorId,
            players: players.map(p => p.id),
            confirmed: []
        });
        await db.set('activeMatches', activeMatches);
    }
}

async function handleMatchConfirm(interaction, dbData) {
    const { channel, user, customId } = interaction;
    const mediatorId = customId.split('_')[2];

    const activeMatches = dbData.activeMatches || [];
    const match = activeMatches.find(m => m.channelId === channel.id);

    if (!match) return interaction.reply({ content: 'Partida não encontrada.', ephemeral: true });
    if (!match.players.includes(user.id)) return interaction.reply({ content: 'Você não é um jogador desta partida.', ephemeral: true });
    if (match.confirmed.includes(user.id)) return interaction.reply({ content: 'Você já confirmou.', ephemeral: true });

    match.confirmed.push(user.id);
    await db.set('activeMatches', activeMatches);

    await interaction.reply({ content: `${user} confirmou! (${match.confirmed.length}/${match.players.length})` });

    if (match.confirmed.length === match.players.length) {
        const mediatorData = dbData.mediators[mediatorId];
        if (mediatorData && mediatorData.pix) {
            const { EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, AttachmentBuilder } = require('discord.js');
            const qrcode = require('qrcode');

            const pixKey = mediatorData.pix;

            try {
                const qrCodeBuffer = await qrcode.toBuffer(pixKey, { type: 'png', color: { dark: '#000', light: '#FFF' } });
                const attachment = new AttachmentBuilder(qrCodeBuffer, { name: 'qrcode.png' });

                const embed = new EmbedBuilder()
                    .setTitle('💸 Pagamento Pix do Mediador')
                    .setDescription(
                        `---
                        **1. Escaneie o Código:**
                        *O QR code para pagamento está na imagem anexada abaixo.*

                        ---
                        **2. Ou Use a Chave:**
                        🔑 **${pixKey}**

                        ---
                        > Lebre-se de enviar o comprovante de pagamento ao mediador`
                    )
                    .setColor('#1E90FF')
                    .setFooter({ text: 'diamodff7x' })
                    .setThumbnail('https://cdn.discordapp.com/attachments/1442275309721358498/1443310621306388642/4a5d08808a19c5eb00828b2a63cad70d.jpg')
                    .setImage('attachment://qrcode.png')
                    .setTimestamp();

                const row = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId(`copy_pix_key_${mediatorId}`)
                            .setLabel('Copiar Chave')
                            .setStyle(ButtonStyle.Primary)
                            .setEmoji('📋')
                    );

                await channel.send({ content: `Todos confirmaram! Pagamento para <@${mediatorId}>:`, embeds: [embed], components: [row], files: [attachment] });






            } catch (error) {
                console.error('Erro ao gerar QR Code ou enviar painel de pagamento:', error);
                await channel.send({ content: `Todos confirmaram!\n\nOcorreu um erro ao gerar o QR Code. Por favor, use a chave manual:\n**Chave Pix do Mediador (<@${mediatorId}>):**\n\`${pixKey}\`` });
            }
        } else {
            await channel.send({ content: `Todos confirmaram!\n\n(Erro: Mediador sem Pix cadastrado)` });
        }
    }
}

async function handleMatchClose(interaction, dbData) {
    const { channel } = interaction;
    await interaction.reply('Encerrando canal em 5 segundos...');
    setTimeout(() => channel.delete().catch(() => { }), 5000);

    const activeMatches = dbData.activeMatches || [];
    const newMatches = activeMatches.filter(m => m.channelId !== channel.id);
    await db.set('activeMatches', newMatches);
}