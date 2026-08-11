/*
	Copyright(c) 2021-2026 jvde.github@gmail.com

	This program is free software: you can redistribute it and/or modify
	it under the terms of the GNU General Public License as published by
	the Free Software Foundation, either version 3 of the License, or
	(at your option) any later version.

	This program is distributed in the hope that it will be useful,
	but WITHOUT ANY WARRANTY; without even the implied warranty of
	MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
	GNU General Public License for more details.

	You should have received a copy of the GNU General Public License
	along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

#pragma once
#include <list>
#include <thread>
#include <mutex>
#include <sstream>
#include <fstream>
#include <iomanip>
#include <random>
#include <cstdlib>
#include <cctype>
#include <ctime>
#include <vector>

#include "TemplateString.h"

#ifdef _WIN32
#include <winsock2.h>
#include <ws2tcpip.h>
#else
#include <sys/socket.h>
#include <netdb.h>
#define SOCKET int
#define closesocket close
#endif

#ifdef __ANDROID__
#include <netinet/in.h>
#endif

#include "Stream.h"
#include "Common.h"
#include "TCPServer.h"
#include "Library/ZIP.h"
#include "HTTPServer.h"
#include "HTTPClient.h"
#include "Protocol.h"

#include "JSON/JSON.h"
#include "JSON/StringBuilder.h"
#include "MsgOut.h"

namespace IO
{

	class HTTPStreamer : public OutputMessage
	{

		JSON::StringBuilder builder;
		HTTPClient http;

		std::string json;

		std::thread run_thread;
		bool terminate = false, running = false;

		ZIP zip;
		std::ostringstream oss;

		std::string url, url_json, userpwd;
		bool gzip = false, show_response = true;
		int INTERVAL = 60;
		int TIMEOUT = 10;

		std::string stationid = "null", lat = "null", lon = "null";
		std::string model = "null", model_setting = "null";
		std::string product = "null", vendor = "null", serial = "null", device_setting = "null";

		enum class PROTOCOL
		{
			AISCATCHER,
			APRS,
			LIST,
			AIRFRAMES,
			NMEA
		} protocol = PROTOCOL::AISCATCHER;

		std::string protocol_string = "jsonaiscatcher";

		void post();
		void process();

		void Receive(const JSON::JSON *data, int len, TAG &tag);
		void Receive(const AIS::GPS *data, int len, TAG &tag);

		std::list<std::string> msg_list;
		std::mutex msg_list_mutex;

	public:
		~HTTPStreamer() { Stop(); }
		HTTPStreamer() : OutputMessage("HTTP"), builder(&AIS::KeyMap, JSON_DICT_FULL), url("http://127.0.0.1"), userpwd("") { fmt = MessageFormat::JSON_FULL; }

		Setting &Set(std::string option, std::string arg);

		void Start();
		void Stop();
	};

	class UDPEndPoint
	{
		std::string address;
		std::string port;

		int sourceID = -1;

	public:
		friend class UDPStreamer;
		friend class TCPClientStreamer;

		UDPEndPoint(std::string a, std::string p, int id = -1)
		{
			address = a, port = p;
			sourceID = id;
		}
		int ID() { return sourceID; }
	};

	class UDPStreamer : public OutputMessage
	{
		SOCKET sock = -1;
		struct addrinfo *address = NULL;
		std::string host = "127.0.0.1";
		std::string port = "10110";
		int reset = -1;
		long last_reconnect = 0;
		bool broadcast = false;
		std::string uuid;
		bool include_sample_start = false;

		// HPRadar feeder identity is transport metadata, not NMEA. For an HPR
		// destination we send a tiny control datagram from the same UDP socket:
		//     HPR1|<36-byte UUID>\r\n
		// The actual AIS NMEA datagrams remain byte-for-byte unchanged.
		long hpr_identity_last = 0;
		long hpr_identity_epoch = -1;
		int hpr_identity_burst = 0;

		static std::string hprTrim(const std::string &value)
		{
			const std::string ws = " \t\r\n";
			std::string::size_type first = value.find_first_not_of(ws);
			if (first == std::string::npos)
				return "";
			std::string::size_type last = value.find_last_not_of(ws);
			return value.substr(first, last - first + 1);
		}

		static std::string hprLower(std::string value)
		{
			for (std::string::size_type i = 0; i < value.size(); ++i)
				value[i] = (char)std::tolower((unsigned char)value[i]);
			return value;
		}

		static bool hprValidUUID(const std::string &value)
		{
			if (value.size() != 36)
				return false;
			for (std::string::size_type i = 0; i < value.size(); ++i)
			{
				if (i == 8 || i == 13 || i == 18 || i == 23)
				{
					if (value[i] != '-')
						return false;
				}
				else if (!std::isxdigit((unsigned char)value[i]))
					return false;
			}
			return true;
		}

		static std::string hprReadUUID(const std::string &path)
		{
			std::ifstream in(path.c_str());
			if (!in.is_open())
				return "";
			std::string value;
			std::getline(in, value);
			value = hprLower(hprTrim(value));
			return hprValidUUID(value) ? value : "";
		}

		static bool hprWriteUUID(const std::string &path, const std::string &value)
		{
			std::ofstream out(path.c_str(), std::ios::out | std::ios::trunc);
			if (!out.is_open())
				return false;
			out << value << "\n";
			out.flush();
			return out.good();
		}

		static std::string hprGenerateUUID()
		{
			std::random_device rd;
			unsigned char b[16];
			for (int i = 0; i < 16; ++i)
				b[i] = (unsigned char)(rd() & 0xff);
			b[6] = (unsigned char)((b[6] & 0x0f) | 0x40); // RFC 4122 version 4
			b[8] = (unsigned char)((b[8] & 0x3f) | 0x80); // RFC 4122 variant

			std::ostringstream out;
			out << std::hex << std::setfill('0');
			for (int i = 0; i < 16; ++i)
			{
				if (i == 4 || i == 6 || i == 8 || i == 10)
					out << '-';
				out << std::setw(2) << (unsigned int)b[i];
			}
			return out.str();
		}

		static std::mutex &hprUUIDMutex()
		{
			static std::mutex m;
			return m;
		}

		static std::string &hprUUIDCache()
		{
			static std::string value;
			return value;
		}

		static std::string hprLoadOrCreateUUID()
		{
			const char *envUUID = std::getenv("HPR_FEEDER_UUID");
			if (envUUID)
			{
				std::string value = hprLower(hprTrim(envUUID));
				if (hprValidUUID(value))
					return value;
			}

			std::lock_guard<std::mutex> lock(hprUUIDMutex());
			if (!hprUUIDCache().empty())
				return hprUUIDCache();

			std::vector<std::string> paths;
			const char *envFile = std::getenv("HPR_FEEDER_UUID_FILE");
			if (envFile && *envFile)
				paths.push_back(envFile);
#ifndef _WIN32
			// /data is the preferred persistent volume for feeder containers.
			paths.push_back("/data/hpr-feeder.uuid");
			const char *home = std::getenv("HOME");
			if (home && *home)
				paths.push_back(std::string(home) + "/.aiscatcher-hpr-feeder.uuid");
#else
			const char *local = std::getenv("LOCALAPPDATA");
			if (local && *local)
				paths.push_back(std::string(local) + "\\AIS-catcher-hpr-feeder.uuid");
#endif
			paths.push_back(".hpr-feeder.uuid");

			for (std::vector<std::string>::const_iterator it = paths.begin(); it != paths.end(); ++it)
			{
				std::string value = hprReadUUID(*it);
				if (!value.empty())
				{
					hprUUIDCache() = value;
					return value;
				}
			}

			std::string generated = hprGenerateUUID();
			for (std::vector<std::string>::const_iterator it = paths.begin(); it != paths.end(); ++it)
			{
				if (hprWriteUUID(*it, generated))
				{
					hprUUIDCache() = generated;
					return generated;
				}
			}

			// Feeding must not stop because the state directory is read-only. The UUID
			// remains stable for this process; operators can set HPR_FEEDER_UUID_FILE
			// to a persistent writable path for immutable identity across restarts.
			hprUUIDCache() = generated;
			return generated;
		}

		bool isHPRTarget() const
		{
			if (fmt != MessageFormat::NMEA)
				return false;

			std::string mode = "auto";
			const char *envMode = std::getenv("HPR_FEEDER_MODE");
			if (envMode && *envMode)
				mode = hprLower(hprTrim(envMode));

			if (mode == "off" || mode == "false" || mode == "0" || mode == "no")
				return false;
			if (mode == "on" || mode == "true" || mode == "1" || mode == "yes")
				return true;

			std::string h = hprLower(hprTrim(host));
			while (!h.empty() && h[h.size() - 1] == '.')
				h.erase(h.size() - 1);
			if (h == "hpradar.com")
				return true;
			static const std::string suffix = ".hpradar.com";
			return h.size() > suffix.size() && h.compare(h.size() - suffix.size(), suffix.size(), suffix) == 0;
		}

		void SendHPRIdentityIfNeeded()
		{
			if (sock == -1 || address == NULL || !isHPRTarget())
				return;

			if (uuid.empty())
				uuid = hprLoadOrCreateUUID();
			if (!hprValidUUID(uuid))
				return;

			// RESET recreates the UDP socket/NAT mapping. Force the initial identity
			// burst again whenever that epoch changes.
			if (reset > 0 && hpr_identity_epoch != last_reconnect)
			{
				hpr_identity_epoch = last_reconnect;
				hpr_identity_last = 0;
				hpr_identity_burst = 0;
			}

			const long now = (long)std::time(NULL);
			if (hpr_identity_burst >= 3 && (now - hpr_identity_last) < 30)
				return;

			const std::string frame = "HPR1|" + hprLower(uuid) + "\r\n";
			stats.bytes_out += frame.length();
			sendto(sock, frame.c_str(), (int)frame.length(), 0, address->ai_addr, (int)address->ai_addrlen);
			hpr_identity_last = now;
			if (hpr_identity_burst < 3)
				++hpr_identity_burst;
		}

		void ResetIfNeeded();

	public:
		~UDPStreamer();
		UDPStreamer() : OutputMessage("UDP")
		{
			fmt = MessageFormat::NMEA;
		}

		Setting &Set(std::string option, std::string arg);

		void Receive(const AIS::Message *data, int len, TAG &tag);
		void Receive(const JSON::JSON *data, int len, TAG &tag);
		void Receive(const AIS::GPS *data, int len, TAG &tag);

		void Start();
		void Start(UDPEndPoint &u)
		{
			host = u.address;
			port = u.port;
			Start();
		}
		void Stop();
		void SendTo(std::string str)
		{
			SendHPRIdentityIfNeeded();
			stats.bytes_out += str.length();
			sendto(sock, str.c_str(), (int)str.length(), 0, address->ai_addr, (int)address->ai_addrlen);
		}
	};

	class TCPClientStreamer : public OutputMessage
	{
		Protocol::TCP tcp;
		Protocol::ProtocolBase *connection = nullptr;
		std::string host = "127.0.0.1";
		std::string port = "10110";
		bool keep_alive = false;
		bool persistent = true;
		std::string uuid;
		bool include_sample_start = false;
		unsigned long lines_sent = 0;

	public:
		TCPClientStreamer() : OutputMessage("TCP Client") { fmt = MessageFormat::NMEA; }

		Setting &Set(std::string option, std::string arg);

		void Receive(const AIS::Message *data, int len, TAG &tag);
		void Receive(const JSON::JSON *data, int len, TAG &tag);
		void Receive(const AIS::GPS *data, int len, TAG &tag);

		void Start();
		void Stop();

		int SendTo(std::string str)
		{
			if (connection)
			{
				lines_sent++;
				return connection->send(str.c_str(), (int)str.length());
			}

			return -1;
		}

		int SendTo(const char *str)
		{
			if (connection)
			{
				lines_sent++;
				return connection->send(str, strlen(str));
			}
			return -1;
		}

		bool isFirstDataSend()
		{
			return tcp.getBytesSent() == 0;
		}
	};

	class TCPlistenerStreamer : public OutputMessage, public IO::TCPServer
	{
		int port = 5010;
		bool include_sample_start = false;

	public:
		TCPlistenerStreamer() : OutputMessage("TCP Listener") { fmt = MessageFormat::NMEA; }

		virtual ~TCPlistenerStreamer() {}

		Setting &Set(std::string option, std::string arg);

		void Receive(const AIS::Message *data, int len, TAG &tag);
		void Receive(const JSON::JSON *data, int len, TAG &tag);
		void Receive(const AIS::GPS *data, int len, TAG &tag);

		void Start();
		void Stop() {}
	};

	class MQTTStreamer : public OutputMessage
	{

	private:
		PROTOCOL Protocol = PROTOCOL::MQTT;
		Protocol::TCP tcp;
		Protocol::MQTT mqtt;
		Protocol::TLS tls;
		Protocol::WebSocket ws;
		Protocol::ProtocolBase *session = &tcp;

		std::string json;
		Util::TemplateString topic_template;

	public:
		MQTTStreamer() : OutputMessage("MQTT"), topic_template("ais/data")
		{
			fmt = MessageFormat::JSON_FULL;
		}

		void Start();
		void Stop();

		void Receive(const AIS::Message *data, int len, TAG &tag);
		void Receive(const JSON::JSON *data, int len, TAG &tag);

		Setting &Set(std::string option, std::string arg);
	};
}