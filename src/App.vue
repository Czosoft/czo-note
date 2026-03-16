<script setup>
import { ref } from 'vue'
import HelloWorld from './components/HelloWorld.vue'
import TheWelcome from './components/TheWelcome.vue'
import Notepad from './components/Notepad.vue'

const isAuthorized = ref(false)
const password = ref('')
const currentView = ref('home') // 'home' 或 'notepad'

const checkPassword = () => {
  console.log('Password entered:', password.value) // 调试信息
  if (password.value.trim() === '1234') { 
    isAuthorized.value = true
  } else {
    alert('密码错误')
  }
}
</script>

<template>
  <div v-if="!isAuthorized" class="login-container">
    <div class="login-box">
      <h3>请输入密码访问</h3>
      <input 
        v-model="password" 
        type="password" 
        @keyup.enter="checkPassword" 
        placeholder="密码"
        class="password-input"
      />
      <button @click="checkPassword" class="login-button">进入</button>
    </div>
  </div>

    <template v-else>
    <div class="app-layout">
      <nav class="side-nav">
        <div class="nav-brand">
          <img alt="Vue logo" class="mini-logo" src="./assets/logo.svg" />
        </div>
        <button 
          :class="{ active: currentView === 'home' }" 
          @click="currentView = 'home'"
          title="首页"
        >
          <span class="nav-icon">🏠</span>
          <span class="nav-text">首页</span>
        </button>
        <button 
          :class="{ active: currentView === 'notepad' }" 
          @click="currentView = 'notepad'"
          title="记事本"
        >
          <span class="nav-icon">📝</span>
          <span class="nav-text">记事本</span>
        </button>
      </nav>

      <main class="content-area">
        <div v-if="currentView === 'home'" class="home-view">
          <header>
            <img alt="Vue logo" class="logo" src="./assets/logo.svg" width="125" height="125" />
            <div class="wrapper">
              <HelloWorld msg="欢迎使用" />
            </div>
          </header>
          <div class="welcome-container">
            <TheWelcome />
          </div>
        </div>

        <div v-else-if="currentView === 'notepad'" class="notepad-view">
          <Notepad />
        </div>
      </main>
    </div>
  </template>
</template>

<style>
:root {
  --primary-color: #42b883;
  --primary-hover: #33a06f;
  --bg-color: #f8f9fa;
  --card-bg: #ffffff;
  --text-main: #2c3e50;
  --text-mute: #6c757d;
  --border-color: #e9ecef;
  --side-nav-width: 80px;
}

body {
  margin: 0;
  padding: 0;
  overflow: hidden;
}
</style>

<style scoped>
.app-layout {
  display: flex;
  width: 100vw;
  height: 100vh;
  background: var(--bg-color);
}

.side-nav {
  width: var(--side-nav-width);
  background: #2c3e50;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 20px 0;
  gap: 15px;
  box-shadow: 2px 0 10px rgba(0,0,0,0.1);
  z-index: 100;
}

.nav-brand {
  margin-bottom: 20px;
}

.mini-logo {
  width: 32px;
  height: 32px;
}

.side-nav button {
  width: 60px;
  height: 60px;
  border: none;
  background: transparent;
  color: #a8b2bd;
  border-radius: 12px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.side-nav button:hover {
  background: rgba(255, 255, 255, 0.1);
  color: white;
}

.side-nav button.active {
  background: var(--primary-color);
  color: white;
  box-shadow: 0 4px 12px rgba(66, 184, 131, 0.3);
}

.nav-icon {
  font-size: 20px;
  margin-bottom: 4px;
}

.nav-text {
  font-size: 10px;
  font-weight: 500;
}

.content-area {
  flex: 1;
  overflow: hidden;
  position: relative;
  display: flex;
  flex-direction: column;
}

.home-view {
  height: 100%;
  overflow-y: auto;
  padding: 2rem;
}

.welcome-container {
  max-width: 1000px;
  margin: 0 auto;
}

.notepad-view {
  flex: 1;
  height: 100%;
}

.login-container {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  display: flex;
  justify-content: center;
  align-items: center;
  background: #f0f2f5;
  z-index: 10000;
}

.login-box {
  background: white;
  padding: 2.5rem;
  border-radius: 16px;
  box-shadow: 0 10px 25px rgba(0,0,0,0.05);
  text-align: center;
  width: 350px;
}

.login-box h3 {
  margin-bottom: 1.5rem;
  color: var(--text-main);
  font-weight: 600;
}

.password-input {
  display: block;
  width: 100%;
  margin: 1rem 0;
  padding: 12px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: #fdfdfd;
  color: var(--text-main);
  font-size: 1rem;
  transition: border-color 0.3s;
}

.password-input:focus {
  outline: none;
  border-color: var(--primary-color);
}

.login-button {
  width: 100%;
  padding: 12px;
  background: var(--primary-color);
  color: white;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  font-weight: 600;
  font-size: 1rem;
  transition: all 0.3s;
}

.login-button:hover {
  background: var(--primary-hover);
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(66, 184, 131, 0.2);
}

header {
  line-height: 1.5;
  margin-bottom: 3rem;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.logo {
  display: block;
  margin-bottom: 2rem;
}

@media (min-width: 1024px) {
  header {
    flex-direction: row;
    justify-content: center;
    gap: 3rem;
  }

  .logo {
    margin: 0;
  }
}
</style>
