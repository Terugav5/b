const { SlashCommandBuilder, ActionRowBuilder, StringSelectMenuBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('criar-filas')
        .setDescription('Painel interativo para criar filas')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    async execute(interaction) {
        const row = new ActionRowBuilder()
            .addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId('queue_setup_mode')
                    .setPlaceholder('Selecione a modalidade')
                    .addOptions(
                        { label: 'Mobile', value: 'mobile' },
                        { label: 'Emulador', value: 'emulador' },
                        { label: 'Tático', value: 'tatico' },
                        { label: 'Misto', value: 'misto' },
                    ),
            );

        await interaction.reply({ content: 'Iniciando configuração de filas. Selecione a modalidade:', components: [row], ephemeral: true });
    },
};
