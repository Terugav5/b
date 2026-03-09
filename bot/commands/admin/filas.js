const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { publishQueues } = require('../../utils/queuePublisher');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('filas')
        .setDescription('Envia as filas configuradas')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });
        const result = await publishQueues(interaction.client, interaction.guild.id);
        if (result.count === 0) {
            return interaction.editReply({ content: 'Nenhuma fila configurada. Use /criar-filas primeiro.' });
        }
        await interaction.editReply({ content: `Filas enviadas com sucesso! (${result.count})` });
    },
};
