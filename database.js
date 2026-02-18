const { Sequelize, DataTypes } = require('sequelize');

//conectar base de datos
const sequelize = new Sequelize({
    dialect: 'sqlite',
    storage: './gastos.sqlite',
    logging: false
});

const Gasto  = sequelize.define('Gasto', {
    fecha: {
        type: DataTypes.STRING,
        allowNull: false
    },
    description:{
        type: DataTypes.STRING,
        allowNull: false
    },
    monto:{
        type: DataTypes.FLOAT,
        allowNull: false
    },
    categoria:{
        type: DataTypes.STRING,
        defaultValue: 'Sin categoria'
    },
    tarjeta:{
        type: DataTypes.STRING
    }
});

const iniciarDB = async () => {
    await sequelize.sync();
    console.log('Base de datos sincronizada');
};

module.exports = {Gasto, iniciarDB};







































