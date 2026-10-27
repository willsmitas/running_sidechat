import { Route, Routes } from 'react-router-dom';
import { useSession } from './session.jsx';
import Layout from './components/Layout.jsx';
import Spinner from './components/Spinner.jsx';
import Home from './pages/Home.jsx';
import Board from './pages/Board.jsx';
import Boards from './pages/Boards.jsx';
import Conferences from './pages/Conferences.jsx';
import Post from './pages/Post.jsx';
import NewPost from './pages/NewPost.jsx';
import { Forgot, Login, Signup } from './pages/Auth.jsx';
import VerifyCollege from './pages/VerifyCollege.jsx';
import Notifications from './pages/Notifications.jsx';
import { Chat, ChatList } from './pages/Chats.jsx';
import Me from './pages/Me.jsx';
import Search from './pages/Search.jsx';
import Admin from './pages/Admin.jsx';
import { About, NotFound, Rules } from './pages/Static.jsx';

export default function App() {
  const { loading } = useSession();
  if (loading) return <div className="boot"><Spinner /></div>;
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/college" element={<Home scope="college" />} />
        <Route path="/boards" element={<Boards />} />
        <Route path="/conferences" element={<Conferences />} />
        <Route path="/b/:slug" element={<Board />} />
        <Route path="/p/:id" element={<Post />} />
        <Route path="/new" element={<NewPost />} />
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/forgot" element={<Forgot />} />
        <Route path="/verify-college" element={<VerifyCollege />} />
        <Route path="/notifications" element={<Notifications />} />
        <Route path="/chats" element={<ChatList />} />
        <Route path="/chats/:id" element={<Chat />} />
        <Route path="/me" element={<Me />} />
        <Route path="/search" element={<Search />} />
        <Route path="/admin" element={<Admin />} />
        <Route path="/rules" element={<Rules />} />
        <Route path="/about" element={<About />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Layout>
  );
}
