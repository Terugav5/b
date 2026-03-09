const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const db = require('../../utils/db');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('vencedor')
        .setDescription('Registrar vencedor e perdedor de uma partida')
        .addUserOption(option =>
            option.setName('vencedor')
                .setDescription('O jogador vencedor')
                .setRequired(true))
        .addUserOption(option =>
            option.setName('perdedor')
                .setDescription('O jogador perdedor')
                .setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        const winner = interaction.options.getUser('vencedor');
        const loser = interaction.options.getUser('perdedor');

        if (winner.id === loser.id) {
            return interaction.editReply('❌ O vencedor e o perdedor não podem ser a mesma pessoa!');
        }

        const stats = await db.get('stats') || {};

        // Update winner
        if (!stats[winner.id]) {
            stats[winner.id] = { wins: 0, losses: 0, winStreak: 0, totalMatches: 0, maxWinStreak: 0 };
        }
        stats[winner.id].wins++;
        stats[winner.id].winStreak++;
        stats[winner.id].totalMatches++;
        if (stats[winner.id].winStreak > (stats[winner.id].maxWinStreak || 0)) {
            stats[winner.id].maxWinStreak = stats[winner.id].winStreak;
        }

        // Update loser
        if (!stats[loser.id]) {
            stats[loser.id] = { wins: 0, losses: 0, winStreak: 0, totalMatches: 0, maxWinStreak: 0 };
        }
        stats[loser.id].losses++;
        stats[loser.id].winStreak = 0;
        stats[loser.id].totalMatches++;

        await db.set('stats', stats);

        await interaction.editReply(
            `✅ **Partida Registrada**\n\n` +
            `🏆 Vencedor: ${winner}\n` +
            `Vitórias: ${stats[winner.id].wins}\n` +
            `Sequência: ${stats[winner.id].winStreak}\n\n` +
            `❌ Perdedor: ${loser}\n` +
            `Derrotas: ${stats[loser.id].losses}\n` +
            `Sequência: ${stats[loser.id].winStreak}`
        );
    },
};