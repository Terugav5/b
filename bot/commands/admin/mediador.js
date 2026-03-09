const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('../../utils/db');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('mediador')
        .setDescription('Configura o sistema de mediadores')
        .addRoleOption(option =>
            option.setName('cargo')
                .setDescription('O cargo de mediador')
                .setRequired(true))
        .addChannelOption(option =>
            option.setName('canal')
                .setDescription('O canal do painel de mediadores')
                .setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });
        const role = interaction.options.getRole('cargo');
        const channel = interaction.options.getChannel('canal');

        // Save config
        const config = await db.get('config');
        config.mediatorRole = role.id;
        config.mediatorChannel = channel.id;
        await db.set('config', config);

        // Create Panel
        const embed = new EmbedBuilder()
            .setTitle('Painel de Mediadores')
            .setDescription('Não há mediadores no momento')
            .setColor('Blue')
            .setTimestamp();

        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('mediator_join')
                    .setLabel('Entrar')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId('mediator_leave')
                    .setLabel('Sair')
                    .setStyle(ButtonStyle.Danger)
            );

        const message = await channel.send({ embeds: [embed], components: [row] });

        config.mediatorMessageId = message.id;
        await db.set('config', config);

        await interaction.editReply({ content: `Sistema de mediadores configurado com sucesso! Cargo: ${role}, Canal: ${channel}` });
    },
};
