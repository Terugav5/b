const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, PermissionsBitField } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('org')
        .setDescription('Organiza o servidor criando cargos, categorias e canais.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    async execute(interaction) {
        await interaction.reply({ content: 'Iniciando organização do servidor...', ephemeral: true });

        const guild = interaction.guild;

        try {
            // --- CARGOS ---
            const rolesData = [
                { name: 'Dono', color: '#010101' },
                { name: 'Vice Dono', color: '#FFFFFF' },
                { name: 'Bots', color: '#808080' },
                { name: 'Diretor dos SS', color: '#FF0000' },
                { name: 'SS', color: '#FF7F7F' },
                { name: 'Mediador', color: '#00FF00' },
                { name: 'Suporte', color: '#90EE90' },
                { name: 'Hydra-Pessoas', color: '#800080' }
            ];

            const createdRoles = {};

            for (const roleData of rolesData) {
                let role = guild.roles.cache.find(r => r.name === roleData.name);
                if (!role) {
                    role = await guild.roles.create({
                        name: roleData.name,
                        color: roleData.color,
                        reason: 'Comando /org'
                    });
                }
                createdRoles[roleData.name] = role;
            }

            // Atribuir cargo "Bots" a todos os bots
            const botsRole = createdRoles['Bots'];
            const members = await guild.members.fetch();
            const bots = members.filter(m => m.user.bot);
            for (const [id, bot] of bots) {
                if (!bot.roles.cache.has(botsRole.id)) {
                    await bot.roles.add(botsRole).catch(() => {});
                }
            }

            // --- ESTRUTURA ---
            const structure = [
                {
                    name: 'Bem vindo',
                    channels: [
                        { name: '💎 bem-vindos', type: ChannelType.GuildText },
                        { name: '👑 invites', type: ChannelType.GuildText }
                    ]
                },
                {
                    name: 'Suas apostas',
                    channels: [
                        { name: '💎 suas-apostas', type: ChannelType.GuildText }
                    ]
                },
                {
                    name: 'Comunidade',
                    channels: [
                        { name: '🔔 aviso', type: ChannelType.GuildText },
                        { name: '💬 chat-geral', type: ChannelType.GuildText },
                        { name: '📈 ranking', type: ChannelType.GuildText },
                        { name: '🌐 perfil', type: ChannelType.GuildText }
                    ]
                },
                {
                    name: 'Parcerias',
                    channels: [
                        { name: '🤝 parcerias', type: ChannelType.GuildText },
                        { name: '💎 divulgação', type: ChannelType.GuildText }
                    ]
                },
                {
                    name: 'Seja adm',
                    channels: [
                        { name: '💵 seja-adm', type: ChannelType.GuildText },
                        { name: '💵 seja-ss', type: ChannelType.GuildText },
                        { name: '💵 seja-aux', type: ChannelType.GuildText },
                        { name: '💸 adms-lucrando', type: ChannelType.GuildText }
                    ]
                },
                {
                    name: 'Regras',
                    channels: [
                        { name: '📘 regra-x1', type: ChannelType.GuildText },
                        { name: '📘 regras-geral', type: ChannelType.GuildText },
                        { name: '🏛️ bancos-proibidos', type: ChannelType.GuildText }
                    ]
                },
                {
                    name: '🏅 | ATRATIVOS',
                    channels: [
                        { name: '🎉 evento-pix', type: ChannelType.GuildText },
                        { name: '🎁 evento-de-invite', type: ChannelType.GuildText },
                        { name: '💸 2win-1-no-pix', type: ChannelType.GuildText },
                        { name: '💵 7win-10-no-pix', type: ChannelType.GuildText }
                    ]
                },
                {
                    name: '📬 | SUPORTE',
                    channels: [
                        { name: '📮 ticket', type: ChannelType.GuildText },
                        { name: '📮 suporte', type: ChannelType.GuildText },
                        { name: '📮 reembolso', type: ChannelType.GuildText },
                        { name: '📮 receber-eventos', type: ChannelType.GuildText },
                        { name: '📮 vagas-mediador', type: ChannelType.GuildText },
                        { name: '🔊 ATENDIMENTO 2', type: ChannelType.GuildVoice },
                        { name: '🔊 ATENDIMENTO 1', type: ChannelType.GuildVoice }
                    ]
                },
                {
                    name: 'Mobile',
                    channels: [
                        { name: '📱 1v1-mob', type: ChannelType.GuildText },
                        { name: '📱 2v2-mob', type: ChannelType.GuildText },
                        { name: '📱 3v3-mob', type: ChannelType.GuildText },
                        { name: '📱 4v4-mob', type: ChannelType.GuildText }
                    ]
                },
                {
                    name: 'Emulador',
                    channels: [
                        { name: '🖥️ 1v1-emu', type: ChannelType.GuildText },
                        { name: '🖥️ 2v2-emu', type: ChannelType.GuildText },
                        { name: '🖥️ 3v3-emu', type: ChannelType.GuildText },
                        { name: '🖥️ 4v4-emu', type: ChannelType.GuildText }
                    ]
                },
                {
                    name: 'Misto',
                    channels: [
                        { name: '📱🖥️ 1v1-misto', type: ChannelType.GuildText },
                        { name: '📱🖥️ 2v2-misto', type: ChannelType.GuildText },
                        { name: '📱🖥️ 3v3-misto', type: ChannelType.GuildText },
                        { name: '📱🖥️ 4v4-misto', type: ChannelType.GuildText }
                    ]
                }
            ];

            for (const catData of structure) {
                let category = guild.channels.cache.find(c => c.name === catData.name && c.type === ChannelType.GuildCategory);
                if (!category) {
                    category = await guild.channels.create({
                        name: catData.name,
                        type: ChannelType.GuildCategory,
                        reason: 'Comando /org'
                    });
                }

                for (const chanData of catData.channels) {
                    let channel = guild.channels.cache.find(c => c.name === chanData.name && c.type === chanData.type && c.parentId === category.id);
                    if (!channel) {
                        await guild.channels.create({
                            name: chanData.name,
                            type: chanData.type,
                            parent: category.id,
                            reason: 'Comando /org'
                        });
                    }
                }
            }

            await interaction.editReply({ content: 'Organização concluída com sucesso! Cargos, categorias e canais criados.' });
        } catch (error) {
            console.error(error);
            await interaction.editReply({ content: 'Ocorreu um erro ao organizar o servidor. Verifique minhas permissões.' });
        }
    },
};
