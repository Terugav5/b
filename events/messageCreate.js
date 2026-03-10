const { Events, EmbedBuilder } = require('discord.js');
const db = require('../utils/db');

module.exports = {
    name: Events.MessageCreate,
    async execute(message) {
        // Ignorar mensagens de bots
        if (message.author.bot) return;

        // Verificar se começa com o prefixo
        const prefix = '.';
        if (!message.content.startsWith(prefix)) return;

        const args = message.content.slice(prefix.length).trim().split(/ +/);
        const command = args.shift().toLowerCase();

        if (command === 'p') {
            // Comando .p para ver estatísticas
            let targetUser;

            if (message.mentions.has(message.author.id) || args.length === 0) {
                // Se mencionou a si mesmo ou não há argumentos, mostra suas próprias stats
                targetUser = message.author;
            } else if (message.mentions.users.size > 0) {
                // Se há menções, pega a primeira
                targetUser = message.mentions.users.first();
            } else {
                return message.reply({ content: '❌ Use: `.p @pessoa` ou `.p` para ver suas estatísticas.' });
            }

            const stats = await db.get('stats') || {};
            const userStats = stats[targetUser.id] || { wins: 0, losses: 0, winStreak: 0, maxWinStreak: 0, totalMatches: 0 };

            const embed = new EmbedBuilder()
                .setAuthor({ name: targetUser.username, iconURL: targetUser.displayAvatarURL() })
                .setTitle('🎮 Estatísticas')
                .setDescription(
                    `**Vitórias**: ${userStats.wins}\n` +
                    `**Derrotas**: ${userStats.losses}\n` +
                    `**Sequência Atual**: ${userStats.winStreak}\n` +
                    `**Melhor Sequência**: ${userStats.maxWinStreak || 0}\n` +
                    `**Total de Partidas**: ${userStats.totalMatches}`
                )
                .setThumbnail(targetUser.displayAvatarURL())
                .setColor('#1E90FF')
                .setTimestamp();

            await message.reply({ embeds: [embed] });
        }
    },
};
