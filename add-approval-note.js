// Script para adicionar coluna approval_note na tabela deliveries
const { pool } = require('./database/db');

async function addApprovalNote() {
    console.log('🔄 Adicionando coluna approval_note...');
    
    try {
        // SQLite - adicionar coluna se não existir
        await new Promise((resolve, reject) => {
            pool.run(`ALTER TABLE deliveries ADD COLUMN approval_note TEXT`, (err) => {
                if (err) {
                    if (err.message.includes('duplicate column') || err.message.includes('already exists')) {
                        console.log('✅ Coluna approval_note já existe');
                        resolve();
                    } else {
                        reject(err);
                    }
                } else {
                    console.log('✅ Coluna approval_note adicionada com sucesso!');
                    resolve();
                }
            });
        });
        
        console.log('✅ Migração concluída!');
        process.exit(0);
    } catch (error) {
        console.error('❌ Erro:', error);
        process.exit(1);
    }
}

addApprovalNote();
