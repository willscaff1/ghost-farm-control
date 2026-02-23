const { runQuery } = require('./database/db');

async function createCompetitionsTable() {
    try {
        console.log('🏆 Criando tabela de competições...');
        
        // Tabela de competições
        await runQuery(`
            CREATE TABLE IF NOT EXISTS competitions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                description TEXT,
                start_date DATE NOT NULL,
                end_date DATE NOT NULL,
                prizes TEXT,
                active INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        console.log('✅ Tabela competitions criada');
        
        // Tabela de participações na competição
        await runQuery(`
            CREATE TABLE IF NOT EXISTS competition_entries (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                competition_id INTEGER NOT NULL,
                user_id INTEGER NOT NULL,
                delivery_id INTEGER NOT NULL,
                material_count INTEGER NOT NULL,
                approved_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (competition_id) REFERENCES competitions(id),
                FOREIGN KEY (user_id) REFERENCES users(id),
                FOREIGN KEY (delivery_id) REFERENCES deliveries(id)
            )
        `);
        
        console.log('✅ Tabela competition_entries criada');
        console.log('✅ Sistema de competições pronto!');
        
        process.exit(0);
    } catch (error) {
        console.error('❌ Erro:', error);
        process.exit(1);
    }
}

createCompetitionsTable();
