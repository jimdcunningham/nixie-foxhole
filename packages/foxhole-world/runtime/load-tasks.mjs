/** Drain siblings before destroying resources shared by parallel load stages. */
export async function completeLoadTasks(tasks) {
 const results=await Promise.allSettled(tasks);
 const failed=results.find(result=>result.status==='rejected');
 if(failed)throw failed.reason;
 return results.map(result=>result.value);
}
