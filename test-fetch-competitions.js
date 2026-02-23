const fetch = require('node-fetch');

async function testFetch() {
    try {
        console.log('🧪 Testando rota /api/admin/competitions...\n');
        
        const response = await fetch('http://localhost:3000/api/admin/competitions', {
            headers: {
                'Cookie': 'connect.sid=s%3Atest' // Simular sessão
            }
        });
        
        console.log('Status:', response.status);
        console.log('Headers:', response.headers.raw());
        
        const text = await response.text();
        console.log('\nBody:', text);
        
        process.exit(0);
    } catch (error) {
        console.error('❌ Erro:', error);
        process.exit(1);
    }
}

testFetch();
