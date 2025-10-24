#!/usr/bin/env node

// 初始化脚本：帮助用户设置cookie并获取token
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { getTokenFromCookie } = require('./lib/token-refresh');

const COOKIE_PATH = path.join(__dirname, 'cookie.txt');
const CONFIG_PATH = path.join(__dirname, 'config.json');

// 创建readline接口
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// 询问用户输入
function askQuestion(question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer.trim());
    });
  });
}

// 显示使用说明
function showInstructions() {
  console.log('='.repeat(80));
  console.log('🍪 通义千问 API 代理 - Cookie 初始化工具');
  console.log('='.repeat(80));
  console.log('');
  console.log('📋 使用说明:');
  console.log('1. 打开浏览器，访问 https://chat.qwen.ai');
  console.log('2. 登录你的账户');
  console.log('3. 打开浏览器开发者工具 (F12)');
  console.log('4. 切换到 Network 标签页');
  console.log('5. 刷新页面或发送一条消息');
  console.log('6. 找到任意一个请求，复制 Cookie 请求头的值');
  console.log('7. 将复制的 Cookie 值粘贴到下面');
  console.log('');
  console.log('💡 提示: Cookie 通常很长，包含多个键值对，用分号分隔');
  console.log('   例如: cna=xxx; token=xxx; ssxmod_itna=xxx; ...');
  console.log('');
}

// 验证cookie格式
function validateCookie(cookie) {
  if (!cookie || cookie.length < 10) {
    return false;
  }
  
  // 检查是否包含常见的cookie字段
  const commonFields = ['cna', 'token', 'ssxmod_itna', 'aui', 'cnaui'];
  const hasCommonFields = commonFields.some(field => cookie.includes(field));
  
  return hasCommonFields;
}

// 保存cookie到文件
function saveCookie(cookie) {
  try {
    fs.writeFileSync(COOKIE_PATH, cookie);
    console.log('✅ Cookie 已保存到 cookie.txt');
    return true;
  } catch (error) {
    console.error('❌ 保存 Cookie 失败:', error.message);
    return false;
  }
}

// 从cookie获取token
async function fetchTokenFromCookie() {
  try {
    console.log('🔄 正在从 Cookie 获取 Token...');
    const result = await getTokenFromCookie();
    
    if (result.success) {
      console.log('✅ Token 获取成功!');
      console.log(`   Token 长度: ${result.newToken.length} 字符`);
      return true;
    } else {
      console.log('❌ Token 获取失败:', result.error);
      return false;
    }
  } catch (error) {
    console.log('❌ 获取 Token 时发生错误:', error.message);
    return false;
  }
}

// 检查现有配置
function checkExistingConfig() {
  if (fs.existsSync(COOKIE_PATH)) {
    const existingCookie = fs.readFileSync(COOKIE_PATH, 'utf-8').trim();
    if (existingCookie) {
      console.log('⚠️  发现现有的 Cookie 文件');
      return existingCookie;
    }
  }
  return null;
}

// 主函数
async function main() {
  try {
    showInstructions();
    
    // 检查现有配置
    const existingCookie = checkExistingConfig();
    if (existingCookie) {
      const useExisting = await askQuestion('是否使用现有的 Cookie? (y/n): ');
      if (useExisting.toLowerCase() === 'y' || useExisting.toLowerCase() === 'yes') {
        console.log('✅ 使用现有 Cookie');
        const success = await fetchTokenFromCookie();
        if (success) {
          console.log('🎉 初始化完成! 现在可以运行 "node main.js" 启动服务');
        } else {
          console.log('❌ 初始化失败，请检查 Cookie 是否有效');
        }
        rl.close();
        return;
      }
    }
    
    // 获取用户输入的cookie
    const cookie = await askQuestion('请粘贴你的 Cookie 值: ');
    
    if (!validateCookie(cookie)) {
      console.log('❌ Cookie 格式不正确，请检查后重试');
      rl.close();
      return;
    }
    
    // 保存cookie
    if (!saveCookie(cookie)) {
      rl.close();
      return;
    }
    
    // 获取token
    const success = await fetchTokenFromCookie();
    if (success) {
      console.log('');
      console.log('🎉 初始化完成!');
      console.log('');
      console.log('📁 文件说明:');
      console.log('  - cookie.txt: 存储你的 Cookie');
      console.log('  - config.json: 存储获取到的 Token');
      console.log('');
      console.log('🚀 现在可以运行以下命令启动服务:');
      console.log('  node main.js');
      console.log('');
      console.log('💡 服务启动后会自动从 Cookie 获取最新的 Token');
    } else {
      console.log('❌ 初始化失败，请检查 Cookie 是否有效');
    }
    
  } catch (error) {
    console.error('❌ 初始化过程中发生错误:', error.message);
  } finally {
    rl.close();
  }
}

// 运行主函数
main();
