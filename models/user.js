// models/user.js

// 'use strict';
const { DataTypes, Model } = require('sequelize');

module.exports = (sequelize) => {
  class User extends Model {
    static associate(models) {
      // Define a one-to-many association with the Post model
      User.hasMany(models.Post, { foreignKey: 'user_id' });
    }
  }

  User.init(
    {
      username: {
        type: DataTypes.STRING,
        allowNull: false,
        comment: 'Username of the user',
      },
      email: {
        type: DataTypes.STRING,
        defaultValue: '',
        comment: 'Email address of the user',
      },
      password: {
        type: DataTypes.STRING,
        allowNull: false,
        comment: 'Password for the user',
      },
      view_index: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 1,
        comment: 'ID of the file the user is currently working on',
      },
      classified_file_count: {
        type: DataTypes.INTEGER.UNSIGNED,
        allowNull: false,
        defaultValue: 0,
        comment: 'Number of files classified by the user',
      },      
    }, {
    sequelize,
    modelName: 'User',
  });

  return User;
};

