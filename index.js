const express = require('express');
const multer = require('multer');
const fs = require('fs');
const csv = require('csv-parser');
const pdf = require('pdf-parse'); 
const { Gasto, iniciarDB } = require('./database');

const app = express();
const upload = multer({ dest: 'uploads/' }); 

app.use(express.static('public')); 
app.use(express.json());

// --- CATEGORIZADOR ---
function categorizar(texto) {
    if (!texto) return 'Varios';
    const t = texto.toLowerCase();
    
    if (t.includes('super') || t.includes('coto') || t.includes('carrefour') || t.includes('dia') || t.includes('jumbo') || t.includes('vea')) return 'Supermercado';
    if (t.includes('uber') || t.includes('cabify') || t.includes('shell') || t.includes('ypf') || t.includes('axion') || t.includes('puma')) return 'Transporte';
    if (t.includes('netflix') || t.includes('spotify') || t.includes('steam') || t.includes('hbo') || t.includes('disney') || t.includes('apple') || t.includes('prime')) return 'Suscripciones';
    if (t.includes('mcdonalds') || t.includes('burger') || t.includes('rappi') || t.includes('pedidosya') || t.includes('starbucks') || t.includes('mostaza')) return 'Comida';
    if (t.includes('farmacia') || t.includes('hospital') || t.includes('osde') || t.includes('swiss') || t.includes('galeno')) return 'Salud';
    if (t.includes('merpago') || t.includes('mercado pago') || t.includes('meli')) return 'MercadoPago/Compras';
    if (t.includes('impuesto') || t.includes('sellos') || t.includes('iva') || t.includes('perc')) return 'Impuestos';
    
    return 'Varios'; 
}

// --- LÓGICA ESPECIAL PARA VISA MACRO (MULTILÍNEA) ---
async function procesarPDF(path) {
    console.log(`📂 Leyendo PDF: ${path}`);
    const dataBuffer = fs.readFileSync(path);

    try {
        const data = await pdf(dataBuffer);
        const texto = data.text;
        
        // Dividimos por renglón y limpiamos espacios vacíos
        const lineas = texto.split('\n').map(l => l.trim()).filter(l => l.length > 0);
        const resultados = [];
        
        // Regex estricta para formato: 02.01.26 (dd.mm.yy)
        const regexFecha = /^(\d{2}\.\d{2}\.\d{2})$/;
        
        // Regex para dinero ARG: 1.000,00 o 10,00 (Puntos para miles, coma para decimal)
        // Busca un numero que termine obligatoriamente en ,XX
        const regexMonto = /[0-9]{1,3}(?:\.[0-9]{3})*,[0-9]{2}/; 

        // Recorremos línea por línea
        for (let i = 0; i < lineas.length; i++) {
            const lineaActual = lineas[i];

            // 1. ¿Esta línea es una FECHA? (Ej: 02.01.26)
            if (regexFecha.test(lineaActual)) {
                
                // ¡Encontramos el inicio de un gasto!
                const fecha = lineaActual;
                let descripcion = "";
                let monto = null;
                let lineasSaltadas = 0;

                // 2. Miramos las siguientes 5 líneas buscando el MONTO
                for (let j = 1; j <= 5; j++) {
                    const indiceFuturo = i + j;
                    if (indiceFuturo >= lineas.length) break; // Cuidado con el final del archivo

                    const lineaFutura = lineas[indiceFuturo];

                    // ¿Es esto dinero? (Ej: 28.600,00)
                    if (regexMonto.test(lineaFutura)) {
                        // Limpiamos el monto para guardarlo
                        // Quitamos puntos de mil y cambiamos coma por punto decimal para JS
                        const montoLimpio = lineaFutura.match(regexMonto)[0]
                                            .replace(/\./g, '') // Chau puntos de mil
                                            .replace(',', '.'); // Coma a punto
                        
                        monto = parseFloat(montoLimpio);
                        lineasSaltadas = j; // Recordamos cuánto avanzamos para no repetir
                        break; // Dejar de buscar, ya encontramos la plata
                    } else {
                        // Si no es plata y no es otra fecha, es parte de la DESCRIPCIÓN
                        // Evitamos sumar códigos numéricos cortos (como "454507")
                        if (!regexFecha.test(lineaFutura) && isNaN(lineaFutura)) {
                            descripcion += lineaFutura + " ";
                        }
                    }
                }

                // 3. Si encontramos Fecha y Monto, guardamos
                if (monto !== null && !isNaN(monto)) {
                    resultados.push({
                        fecha: fecha,
                        descripcion: descripcion.trim() || "Consumo Visa",
                        monto: monto,
                        categoria: categorizar(descripcion),
                        tarjeta: 'Visa Macro'
                    });
                    
                    // Avanzamos el índice principal 'i' para no leer estas líneas de nuevo
                    i += lineasSaltadas; 
                }
            }
        }

        return resultados;

    } catch (error) {
        console.error("❌ Error leyendo PDF:", error);
        return [];
    }
}

// --- RUTAS ---
app.post('/subir-resumen', upload.single('archivo'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ mensaje: 'Falta archivo' });

        const ext = req.file.originalname.toLowerCase();
        let resultados = [];

        if (ext.endsWith('.pdf')) {
            resultados = await procesarPDF(req.file.path);
            
            if (resultados.length > 0) {
                await Gasto.bulkCreate(resultados);
                fs.unlinkSync(req.file.path);
                res.json({ mensaje: `✅ ¡Éxito! Se detectaron ${resultados.length} gastos en el PDF.` });
            } else {
                fs.unlinkSync(req.file.path);
                res.json({ mensaje: '⚠️ Leí el PDF pero no encontré el patrón de gastos. Revisa la consola.' });
            }

        } else if (ext.endsWith('.csv')) {
            // Lógica CSV (Igual que antes)
            fs.createReadStream(req.file.path)
                .pipe(csv())
                .on('data', (data) => {
                    const valores = Object.values(data);
                    const descripcion = data.Descripcion || data.Concepto || valores[1] || 'Gasto';
                    let montoStr = data.Importe || data.Monto || valores[2] || '0';
                    montoStr = montoStr.toString().replace('$', '').replace(/\./g, '').replace(',', '.').trim();
                    const monto = parseFloat(montoStr);
                    
                    if (!isNaN(monto) && monto !== 0) {
                        resultados.push({
                            fecha: data.Fecha || valores[0],
                            descripcion,
                            monto: Math.abs(monto),
                            categoria: categorizar(descripcion),
                            tarjeta: 'CSV'
                        });
                    }
                })
                .on('end', async () => {
                    await Gasto.bulkCreate(resultados);
                    fs.unlinkSync(req.file.path);
                    res.json({ mensaje: `CSV: Se encontraron ${resultados.length} movimientos.` });
                });
        } else {
            res.status(400).json({ mensaje: 'Solo se aceptan .csv o .pdf' });
        }
    } catch (error) {
        console.error(error);
        res.status(500).json({ mensaje: 'Error interno: ' + error.message });
    }
});

app.get('/api/gastos', async (req, res) => {
    const gastos = await Gasto.findAll({ order: [['id', 'DESC']] });
    res.json(gastos);
});

app.listen(3000, async () => {
    await iniciarDB();
    console.log('✅ Servidor listo en: http://localhost:3000');
});