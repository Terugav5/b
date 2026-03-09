const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits, AttachmentBuilder } = require('discord.js');
const db = require('../../utils/db');
const path = require('path');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('filas')
        .setDescription('Envia as filas configuradas')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        const queues = await db.get('queues') || [];

        if (queues.length === 0) {
            return interaction.editReply({ content: 'Nenhuma fila configurada. Use /criar-filas primeiro.' });
        }

        // Group queues by channel
        const queuesByChannel = {};
        for (const queue of queues) {
            if (!queuesByChannel[queue.channelId]) {
                queuesByChannel[queue.channelId] = [];
            }
            queuesByChannel[queue.channelId].push(queue);
        }

        for (const [channelId, channelQueues] of Object.entries(queuesByChannel)) {
            const channel = await interaction.client.channels.fetch(channelId).catch(() => null);
            if (!channel || channel.guild.id !== interaction.guild.id) continue;

            // Sort queues by value (descending)
            channelQueues.sort((a, b) => Number(b.value) - Number(a.value));

            for (const queue of channelQueues) {
                // Delete old message if exists
                if (queue.messageId) {
                    try {
                        const oldMessage = await channel.messages.fetch(queue.messageId);
                        if (oldMessage) await oldMessage.delete();
                    } catch (e) {
                        // Ignore error if message not found or already deleted
                    }
                }

                const embed = new EmbedBuilder()
                    .setDescription(`${queue.mode.toUpperCase()}\n\nTIPO: ${queue.type.toUpperCase()}\n\nPREÇO: R$${queue.value}\n\nJOGADORES\n${queue.players.length > 0 ? queue.players.map(p => `<@${p.id}>`).join('\n') : 'Nenhum jogador'}`)
                    .setColor('#1E90FF')
                    .setThumbnail('https://cdn.discordapp.com/attachments/1442275309721358498/1443310621306388642/4a5d08808a19c5eb00828b2a63cad70d.jpg')
                    .setFooter({ text: `diamodff7x` });

                const row = new ActionRowBuilder();

                // Define buttons based on mode/type
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

                const sentMessage = await channel.send({ embeds: [embed], components: [row] });
                queue.messageId = sentMessage.id;
            }
        }

        await db.set('queues', queues);

        await interaction.editReply({ content: 'Filas enviadas com sucesso!' });
    },
};
