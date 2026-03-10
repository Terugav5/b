const { SlashCommandBuilder } = require('discord.js');
const db = require('../../utils/db');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('pix')
        .setDescription('Cadastra sua chave Pix')
        .addStringOption(option =>
            option.setName('chave')
                .setDescription('Sua chave Pix')
                .setRequired(true)),
    async execute(interaction) {
        const pixKey = interaction.options.getString('chave');
        const userId = interaction.user.id;

        const mediators = await db.get('mediators');

        if (!mediators[userId]) {
            mediators[userId] = { pix: pixKey, online: false, name: interaction.user.username };
        } else {
            mediators[userId].pix = pixKey;
            mediators[userId].name = interaction.user.username;
        }

        await db.set('mediators', mediators);

        await interaction.reply({ content: `Sua chave Pix foi cadastrada com sucesso: \`${pixKey}\``, ephemeral: true });
    },
};
