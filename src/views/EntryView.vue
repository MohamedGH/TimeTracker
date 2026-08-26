<template>
  <div class="entry-view">
    <TimerCard />
    <EntryCard />
    <ActivitiesCard />
    <EntryList />
    <DataCard />
  </div>
</template>

<script setup lang="ts">
import TimerCard from '../components/TimerCard.vue';
import EntryCard from '../components/EntryCard.vue';
import ActivitiesCard from '../components/ActivitiesCard.vue';
import EntryList from '../components/EntryList.vue';
import DataCard from '../components/DataCard.vue';
</script>
