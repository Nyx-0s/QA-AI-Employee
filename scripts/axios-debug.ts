import axios from 'axios';
(async () => {
  try {
    const response = await axios.post(
      'http://localhost:11434/api/generate',
      {
        model: 'qwen2.5:7b',
        prompt: 'Reply with exactly the single word WORKING.',
        stream: false,
        options: { temperature: 0.15, top_p: 0.8, num_predict: 300, num_ctx: 4096, repeat_penalty: 1.1 }
      },
      { timeout: 60000 }
    );
    console.log('SUCCESS:', JSON.stringify(response.data).substring(0, 300));
  } catch (err: any) {
    console.error('ERROR:', err.message);
    console.error('ERR CODE:', err.code);
    console.error('ERR STATUS:', err.response?.status);
    console.error('ERR RESPONSE DATA:', err.response?.data);
  }
})();
