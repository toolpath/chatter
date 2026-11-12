<script setup lang="ts">
import { withBase } from 'vitepress';
</script>

<template>
  <h1 class="hero-logo">
    <img :src="withBase('/chatter-wordmark-dark.svg')" alt="Chatter by Toolpath" />
  </h1>
</template>

<style scoped>
.hero-logo {
  margin: 0 0 24px;
}

.hero-logo img {
  width: 320px;
  max-width: 100%;
  height: auto;
}
</style>
