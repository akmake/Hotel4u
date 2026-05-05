import React, { useState, useEffect } from 'react';
import axios from 'axios';
import * as XLSX from 'xlsx';
import { Upload, Home, LogIn, LogOut, Clock } from 'lucide-react';
// 👇 תיקון: שימוש ב-Store הקיים במקום ב-Hook שלא קיים
import { useAuthStore } from "@/stores/authStore.js"; 
import RoomCard from '@/components/housekeeping/RoomCard.jsx';

const HousekeepingManager = () => {
  // 👇 שימוש ב-useAuthStore
  const { user } = useAuthStore(); 
  
  const [rooms, setRooms] = useState([]);
  const [filterType, setFilterType] = useState('All');
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState({ arrivals: 0, departures: 0, stayovers: 0, total: 0 });

  useEffect(() => {
    // טוען חדרים רק אם יש משתמש ומזהה מלון
    // תמיכה גם במבנה שבו user.hotel הוא אובייקט וגם כשהוא ID
    if (user?.hotel) {
      fetchActiveRooms();
    }
  }, [user]);

  useEffect(() => {
    const newStats = {
      total: rooms.length,
      arrivals: rooms.filter(r => r.bookingType === 'Arrival' || r.bookingType === 'BackToBack').length,
      departures: rooms.filter(r => r.bookingType === 'Departure' || r.bookingType === 'BackToBack').length,
      stayovers: rooms.filter(r => r.bookingType === 'Stayover').length,
    };
    setStats(newStats);
  }, [rooms]);

  const fetchActiveRooms = async () => {
    try {
      const hotelId = user.hotel._id || user.hotel; 
      const res = await axios.get(`/api/rooms/${hotelId}?activeOnly=true`);
      setRooms(res.data);
    } catch (err) {
      console.error("Failed to fetch rooms", err);
    }
  };

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    const reader = new FileReader();
    reader.onload = async (evt) => {
      const bstr = evt.target.result;
      const wb = XLSX.read(bstr, { type: 'binary' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const data = XLSX.utils.sheet_to_json(ws);

      const formattedData = data.map(row => ({
        roomNumber: row['Room'] || row['חדר'],
        type: row['Status'] || row['סטטוס'], 
        adults: row['Adults'] || 0,
        children: row['Children'] || 0,
        babies: row['Babies'] || 0,
        checkOutDate: row['DepartureDate'] || null, 
        notes: row['Notes'] || ''
      }));

      await uploadSchedule(formattedData);
    };
    reader.readAsBinaryString(file);
  };

  const uploadSchedule = async (data) => {
    setLoading(true);
    try {
      const hotelId = user.hotel._id || user.hotel;
      const res = await axios.post('/api/rooms/upload-daily', { 
        hotelId: hotelId,
        roomsData: data 
      });
      setRooms(res.data.data);
      alert('סידור עבודה עודכן והמשמרת אותחלה!');
      setFilterType('All');
    } catch (err) {
      console.error(err);
      alert('שגיאה בטעינת הקובץ');
    } finally {
      setLoading(false);
    }
  };

  const displayedRooms = rooms.filter(room => {
    if (filterType === 'All') return true;
    if (filterType === 'Arrival') return room.bookingType === 'Arrival' || room.bookingType === 'BackToBack';
    if (filterType === 'Departure') return room.bookingType === 'Departure' || room.bookingType === 'BackToBack';
    if (filterType === 'Stayover') return room.bookingType === 'Stayover';
    return true;
  });

  return (
    <div className="p-6 bg-gray-50 min-h-screen rtl">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-2xl font-bold text-gray-800">ניהול משמרת - {new Date().toLocaleDateString('he-IL')}</h1>
        <div className="relative">
          <input type="file" onChange={handleFileUpload} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
          <button className="bg-blue-600 text-white px-4 py-2 rounded flex items-center gap-2 hover:bg-blue-700">
            <Upload size={20} /> קליטת אקסל יומי
          </button>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4 mb-8">
        <StatCard title="סה״כ בסידור" count={stats.total} icon={<Home/>} active={filterType==='All'} onClick={()=>setFilterType('All')} color="gray"/>
        <StatCard title="הגעות" count={stats.arrivals} icon={<LogIn/>} active={filterType==='Arrival'} onClick={()=>setFilterType('Arrival')} color="green"/>
        <StatCard title="עזיבות" count={stats.departures} icon={<LogOut/>} active={filterType==='Departure'} onClick={()=>setFilterType('Departure')} color="red"/>
        <StatCard title="נשארים" count={stats.stayovers} icon={<Clock/>} active={filterType==='Stayover'} onClick={()=>setFilterType('Stayover')} color="blue"/>
      </div>

      <div className="mb-4 text-lg font-semibold text-gray-700">מציג: {filterType} ({displayedRooms.length})</div>

      {loading ? <div>טוען...</div> : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {displayedRooms.map(room => (
            <RoomCard key={room._id} room={room} isManagerView={true} />
          ))}
        </div>
      )}
    </div>
  );
};

const StatCard = ({ title, count, icon, active, onClick, color }) => (
  <div onClick={onClick} className={`p-4 bg-white rounded-xl shadow cursor-pointer border-2 ${active ? `border-${color}-500` : 'border-transparent'}`}>
    <div className="flex justify-between items-center text-gray-500 mb-2"><span>{title}</span><span className={`text-${color}-500`}>{icon}</span></div>
    <div className={`text-3xl font-bold text-${color}-600`}>{count}</div>
  </div>
);

export default HousekeepingManager;