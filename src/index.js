const { Client, GatewayIntentBits, Routes } = require("discord.js");
const { REST } = require("@discordjs/rest");
const { joinVoiceChannel } = require("@discordjs/voice");
const {
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  NoSubscriberBehavior,
  StreamType,
} = require("@discordjs/voice");

const fs = require("fs");
const path = require("path");
const url = require("url");
//const fetch = require("node-fetch");
const express = require("express");
const dotenv = require("dotenv");
const playdl = require("play-dl");
dotenv.config();

const client = new Client({
  intents: ["Guilds", "GuildMessages", "GuildVoiceStates"],
});
const TOKEN = process.env.TOKEN;
const CLIENT_ID = "1140361276120383568";
const GUILD_ID = "598932217246384129";
client.login(TOKEN);
const ytpl = require("ytpl");
const ytdl = require("ytdl-core");

const rest = new REST({ version: "10" }).setToken(TOKEN);

const queue = [];
let isPlaying = false;
let isPaused = false;
let initializedQueue = false;
let audioPlayer;

var connection;

function addToQueue(url) {
  queue.push(url);
}

client.on("ready", () => {
  console.log(`${client.user.tag} has logged in!`);

  listVoiceChannels();
  //joinVoiceChannelById("650706157064814592");
});

client.on("voiceStateUpdate", (oldState, newState) => {
  if (oldState.member.user.id === client.user.id) {
    // Бот покинул голосовой канал
    if (!newState.channel) {
      clearQueue(); // Очищаем очередь при отключении от голосового канала
      console.log("cleared queue " + queue);
    }
  }
});

playdl.setToken({
  youtube: {
    cookie: process.env.COOKIE,
  },
}); // YouTube Cookies

function clearQueue() {
  queue.length = 0;
  isPlaying = false;
  initializedQueue = false;
  console.log("queue cleared");
}

async function listVoiceChannels() {
  try {
    // Получаем объект гильдии (сервера)
    const guild = await client.guilds.fetch(GUILD_ID);

    // Получаем список голосовых каналов
    const channels = await guild.channels.fetch();

    console.log(`Voice channels in the guild:`);
    channels.forEach((channel) => {
      if (channel.type == "2") {
        console.log(`- ${channel.name} (ID: ${channel.id})`);
      }
    });
  } catch (err) {
    console.log("ups " + err);
  }
}

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const { commandName, options } = interaction;

  if (commandName === "hui") {
    interaction.reply("соси!");
  }
  if (commandName === "play") {
    const url = options.getString("url");
    if (isPlaylistUrl(url)) {
      await interaction.reply("use /addplaylist command for playlist links");
      return;
    }
    // if (!isVideoValid(url)) {
    // await interaction.reply("invalid link");
    //  return;
    //}
    const voiceChannelId = interaction.member.voice.channelId;

    if (!voiceChannelId) {
      await interaction.reply(
        "You must be in a voice channel to use this command."
      );
      return;
    }
    // Добавляем URL в очередь
    addToQueue(url);
    console.log(queue);
    // Если в очереди только одна аудиозапись, начинаем воспроизведение
    if (initializedQueue) {
      sendQueueStatusToChannel("1142097436475658370");
    }
    if (queue.length === 1) {
      connection = joinVoiceChannel({
        channelId: voiceChannelId,
        guildId: GUILD_ID,
        adapterCreator: interaction.guild.voiceAdapterCreator,
      });

      playNextAudio(connection);
    }

    interaction.reply("Added audio to the queue.");
  }
  if (commandName === "pause") {
    // Приостановить воспроизведение
    if (isPlaying) {
      audioPlayer.pause();
      await interaction.reply("Playback paused.");
      isPaused = true;
      sendQueueStatusToChannel("1142097436475658370");
    } else {
      await interaction.reply("No audio is playing.");
    }
  }

  if (commandName === "resume") {
    // Продолжить воспроизведение
    if (isPlaying) {
      audioPlayer.unpause();
      await interaction.reply("Playback resumed.");
      isPaused = false;
      sendQueueStatusToChannel("1142097436475658370");
    } else {
      await interaction.reply("No audio is paused.");
    }
  }

  if (commandName === "skip") {
    // Пропустить текущую аудиозапись
    if (isPlaying) {
      queue.shift();
      playNextAudio(connection);
      if (queue.length == 0) {
        sendQueueStatusToChannel("1142097436475658370");
      }
      await interaction.reply("Skipped current audio.");
    } else {
      await interaction.reply("No audio is playing.");
    }
  }
  if (commandName === "reset") {
    // Пропустить текущую аудиозапись

    clearQueue();
    playNextAudio(connection);
    if (queue.length == 0) {
      sendQueueStatusToChannel("1142097436475658370");
    }
    await interaction.reply("Reset comleted");
  }

  if (commandName === "addplaylist") {
    const playlistUrl = options.getString("playlisturl");
    const voiceChannelId = interaction.member.voice.channelId;

    if (!voiceChannelId) {
      await interaction.reply(
        "You must be in a voice channel to use this command."
      );
      return;
    }
    try {
      const playlist = await ytpl(playlistUrl);

      // Добавляем URL каждого видео из плейлиста в очередь
      playlist.items.forEach((item) => {
        addToQueue(item.url);
      });
      console.log(queue);
      if (queue.length > 1) {
        connection = joinVoiceChannel({
          channelId: voiceChannelId,
          guildId: GUILD_ID,
          adapterCreator: interaction.guild.voiceAdapterCreator,
        });
      }

      // Если бот не проигрывает ничего, начинаем воспроизведение первого видео
      if (!isPlaying) {
        playNextAudio(connection);
      }

      await interaction.reply(
        `Added ${playlist.items.length} videos from the playlist to the queue.`
      );
    } catch (error) {
      console.error("Error adding playlist:", error);
      await interaction.reply("An error occurred while adding the playlist.");
    }
  }
});

async function isVideoValid(url) {
  try {
    await ytdl.getBasicInfo(url);
    return true;
  } catch (error) {
    return false;
  }
}

async function playNextAudio(connection) {
  try {
    if (queue.length === 0) {
      return; // Очередь пуста, просто выходим
    }

    const url = queue[0];
    let video;
    if (isYouTubeLink(url)) {
      video = await playdl.stream(url);
    } else {
      const statusChannel = await client.channels.fetch("1142097436475658370");
      await statusChannel.send(`Wrong url`);
      queue.shift();
      sendQueueStatusToChannel("1142097436475658370");
      playNextAudio(connection);
      return;
    }

    const audioResource = createAudioResource(video.stream, {
      inputType: StreamType.Opus,
    });
    audioPlayer = createAudioPlayer();
    audioPlayer.play(audioResource);
    connection.subscribe(audioPlayer);
    isPlaying = true; // Устанавливаем флаг в true
    // Удаляем первый элемент из очереди
    sendQueueStatusToChannel("1142097436475658370");

    // Слушаем событие окончания воспроизведения
    audioPlayer.on(AudioPlayerStatus.Idle, () => {
      console.log("ended");
      queue.shift();
      isPlaying = false;
      playNextAudio(connection);
      if (queue.length == 0) {
        sendQueueStatusToChannel("1142097436475658370");
      }
    });
  } catch (err) {
    const statusChannel = await client.channels.fetch("1142097436475658370");
    await statusChannel.send("Error:" + err);
    queue.shift();
  }
}

async function main() {
  const commands = [
    {
      name: "hui",
      description: "просто хуй",
    },
    {
      name: "reset",
      description: "Сброс воспроизводимых треков",
    },
    {
      name: "play",
      description: "Воспроизвести аудио из YouTube по ссылке",
      options: [
        {
          type: 3,
          name: "url",
          description: "Ссылка на аудио с YouTube",
          required: true,
        },
      ],
    },
    {
      name: "addplaylist",
      description: "Воспроизвести плейлист из Youtube",
      options: [
        {
          type: 3,
          name: "playlisturl",
          description: "Ссылка на плейлист с YouTube",
          required: true,
        },
      ],
    },
    {
      name: "pause",
      description: "пауза",
    },
    {
      name: "resume",
      description: "продолжить",
    },
    {
      name: "skip",
      description: "скип    ",
    },
  ];
  try {
    console.log("Started refreshing application (/) commands.");
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), {
      body: commands,
    });
    console.log("Successfully reloaded application (/) commands.");
    client.login(TOKEN);
  } catch (err) {
    console.log(err);
  }
}
function isYouTubeLink(link) {
  const youtubeRegex = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.?be)\/.+$/;
  return youtubeRegex.test(link);
}
function isPlaylistUrl(url) {
  // Регулярное выражение для проверки формата URL плейлиста YouTube
  const playlistRegex =
    /^https?:\/\/(www\.)?youtube\.com\/playlist\?list=[a-zA-Z0-9_-]+$/;

  return playlistRegex.test(url);
}

async function sendQueueStatusToChannel(channelId) {
  const statusChannel = await client.channels.fetch(channelId);

  const queueStatus = [];
  let iterations;
  if (queue.length < 6) {
    iterations = queue.length;
  } else {
    iterations = 5;
  }
  for (let i = 0; i < iterations; i++) {
    let title;
    if (i === 0) {
      if (isYouTubeLink(queue[i])) {
        console.log("is yt " + isYouTubeLink(queue[i]));
        const info = await playdl.video_basic_info(queue[i]);
        title = `[${info.video_details.title}](${queue[i]})`;
      } else {
        title = queue[i];
      }
    } else {
      if (isYouTubeLink(queue[i])) {
        const info = await playdl.video_basic_info(queue[i]);
        title = info.video_details.title;
      } else {
        title = "wrong url";
      }
    }
    queueStatus.push(`${i + 1}. ${title}`);
  }
  let dif;
  if (queue.length > 5) {
    dif = queue.length - 5;
    queueStatus.push(`+${dif} audio`);
  }
  const statusMessage = isPaused ? "Currently paused" : "Now playing";

  // Remove all previous messages in the channel
  const messages = await statusChannel.messages.fetch();
  messages.forEach(async (message) => {
    await message.delete().catch(console.error);
  });

  // Send a new message with information
  await statusChannel.send(
    `**Queue Status:**\n${queueStatus.join(
      "\n"
    )}\n\n**Status:** ${statusMessage}`
  );

  initializedQueue = true;
}

main();

const PORT = 3000;
// Ваш код для создания сервера Express
const app = express();
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
// Этот маршрут будет возвращать "success" в случае успешного запуска
app.get("/status", (req, res) => {
  res.send("success");
});

// Пинговать указанный хост каждые 5 минут
async function pingBot() {
  try {
    // Use dynamic import() to import node-fetch as an ESM module
    const fetch = await import("node-fetch");

    const response = await fetch.default(
      "https://greeterbot.onrender.com/status"
    ); // Замените на актуальный URL вашего бота
    if (response.ok) {
      console.log("Bot pinged successfully");
    } else {
      console.error(`Failed to ping bot. Response status: ${response.status}`);
    }
  } catch (error) {
    console.error("Error while pinging bot:", error.message);
  }
}

// Пинговать бота каждые 5 минут
setInterval(pingBot, 60 * 1000 * 5); // 5 минут
